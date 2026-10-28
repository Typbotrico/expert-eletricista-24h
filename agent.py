#!/usr/bin/env python3
"""Fixed-route internal pilot agent. No PSTN numbers or inbound listener."""
import argparse
import fcntl
import getpass
import json
import os
from pathlib import Path
import re
import socket
import time
import urllib.error
import urllib.request
import uuid

ENDPOINT = 'https://central-ligacoes-motor-piloto.onrender.com'
CONFIG = Path('/etc/central-motor-agent')
STATE = Path('/var/lib/central-motor-agent/journal.json')


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    with open(tmp, 'w', encoding='utf8') as out:
        os.chmod(tmp, 0o600)
        json.dump(value, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def api(path, token=None, payload=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(ENDPOINT + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers=headers)
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        return json.load(response)


class AMI:
    def __init__(self, connection):
        self.connection = connection
        self.buffer = b''

    def send(self, values):
        if any('\r' in str(v) or '\n' in str(v) for v in values.values()):
            raise ValueError('AMI field rejected')
        self.connection.sendall(('\r\n'.join(f'{k}: {v}' for k, v in values.items()) + '\r\n\r\n').encode())

    def read(self):
        while b'\r\n\r\n' not in self.buffer:
            part = self.connection.recv(65536)
            if not part:
                raise ConnectionError('AMI disconnected')
            self.buffer += part
            if len(self.buffer) > 262144:
                raise ValueError('AMI frame limit')
        frame, self.buffer = self.buffer.split(b'\r\n\r\n', 1)
        fields = {}
        for line in frame.decode('utf8', errors='replace').split('\r\n'):
            if ': ' in line:
                key, value = line.split(': ', 1)
                fields[key] = value
        return fields

    def login(self, secret):
        self.send({'Action':'Login', 'ActionID':'login', 'Username':'central_piloto', 'Secret':secret, 'Events':'on'})
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            event = self.read()
            if event.get('ActionID') == 'login':
                if event.get('Response') != 'Success':
                    raise PermissionError('AMI login rejected')
                return
        raise TimeoutError('AMI login timeout')


def allowed_job(job):
    return (job.get('kind') == 'internal_echo_1001' and job.get('channel') == 'PJSIP/1001'
            and job.get('exten') == '600' and all(re.fullmatch(r'[a-f0-9-]{36}', str(job.get(k,''))) for k in ('id','lease')))


def observe(ami, action, channel_id, deadline):
    accepted = False
    while time.monotonic() < deadline:
        event = ami.read()
        # A synchronous Success only acknowledges queueing. It is never an answer.
        if event.get('ActionID') == action:
            if event.get('Event') == 'OriginateResponse':
                if event.get('Response') == 'Success' and event.get('Reason') == '4':
                    return 'answered'
                return 'no_answer' if event.get('Reason') == '0' else 'failed'
            if event.get('Response') == 'Error':
                return 'failed'
            if event.get('Response') == 'Success':
                accepted = True
        if event.get('Uniqueid') == channel_id:
            if event.get('Event') == 'Newstate' and event.get('ChannelState') == '6':
                return 'answered'
            if event.get('Event') == 'Hangup':
                return 'no_answer'
    return 'accepted' if accepted else 'unknown'


def originate(job, mark_sent, connector=socket.create_connection):
    if not allowed_job(job):
        return 'failed'
    sent = False
    try:
        secret = (CONFIG / 'ami.secret').read_text().strip()
        with connector(('127.0.0.1', 5038), timeout=5) as connection:
            connection.settimeout(5)
            ami = AMI(connection)
            ami.login(secret)
            # Durable before writing to TCP. A crash at this boundary becomes unknown,
            # never a second Originate, even if the first write actually failed.
            mark_sent()
            sent = True
            channel_id = 'central-' + job['id']
            ami.send({'Action':'Originate','ActionID':job['id'],'Channel':'PJSIP/1001',
                'Context':'central-interna','Exten':'600','Priority':'1',
                'Timeout':'20000','Async':'true','ChannelId':channel_id})
            deadline = time.monotonic() + 27
            while time.monotonic() < deadline:
                try:
                    return observe(ami, job['id'], channel_id, deadline)
                except socket.timeout:
                    continue
            return 'unknown'
    except Exception:
        return 'unknown' if sent else 'failed'


def enroll():
    code = getpass.getpass('Código de pareamento (não aparece ao digitar): ').strip()
    if not re.fullmatch('[a-f0-9]{64}', code):
        raise ValueError('Código inválido. Gere outro no painel.')
    data = api('/api/agent/enroll', payload={'code':code})
    if data.get('scope') != 'internal_echo_1001' or not re.fullmatch('[a-f0-9]{64}', data.get('agentToken','')):
        raise ValueError('Resposta de pareamento inválida')
    atomic(CONFIG / 'token.json', {'token':data['agentToken']})
    print('Notebook pareado. A saída externa permanece bloqueada.')


def run():
    lock = open(STATE.parent / 'agent.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    token = json.loads((CONFIG / 'token.json').read_text())['token']
    journal = json.loads(STATE.read_text()) if STATE.exists() else None
    if journal and journal.get('phase') != 'done':
        journal['outcome'] = journal.get('outcome', 'unknown')
        journal['phase'] = 'report'
        atomic(STATE, journal)
    while True:
        try:
            if journal and journal['phase'] == 'report':
                job = journal['job']
                try:
                    api('/api/agent/report', token, {'id':job['id'], 'lease':job['lease'], 'outcome':journal['outcome']})
                except urllib.error.HTTPError as error:
                    if error.code != 409:
                        raise
                    # A closed/expired lease is never originated again.
                journal['phase'] = 'done'
                atomic(STATE, journal)
                print('Resultado interno registrado: ' + journal['outcome'], flush=True)
            response = api('/api/agent/poll', token)
            if response.get('external_calls_enabled') is not False:
                raise ValueError('Estado do motor rejeitado')
            job = response.get('job')
            if job:
                if journal and journal['job']['id'] == job.get('id'):
                    raise ValueError('Entrega duplicada recusada')
                if not allowed_job(job):
                    raise ValueError('Rota fora do piloto interno')
                journal = {'job':job, 'phase':'prepared'}
                atomic(STATE, journal)
                def mark_sent():
                    journal['phase'] = 'sent'
                    atomic(STATE, journal)
                journal['outcome'] = originate(job, mark_sent)
                journal['phase'] = 'report'
                atomic(STATE, journal)
            else:
                time.sleep(8)
        except Exception:
            # No tokens, AMI responses, caller IDs or contact data in logs.
            print('Conexão indisponível ou operação recusada; aguardando. Nenhuma repetição de chamada.', flush=True)
            time.sleep(15)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--enroll', action='store_true')
    args = parser.parse_args()
    if args.enroll:
        enroll()
    else:
        run()
