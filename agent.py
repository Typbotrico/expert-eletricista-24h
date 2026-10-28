#!/usr/bin/env python3
"""Agente WSL da Central — ONLY ramal PJSIP/1001 -> eco 600 (no PSTN)."""
import hmac
import json
import logging
import os
from pathlib import Path
import socket
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ENDPOINT = os.getenv('CENTRAL_MOTOR_ENDPOINT', 'https://central-ligacoes-motor-piloto.onrender.com').rstrip('/')
AMI_SECRET_PATH = Path('/etc/central-ami-bridge/ami.secret')
MOTOR_TOKEN_PATH = Path('/etc/central-motor-agent/token')
LOG = logging.getLogger('central-motor-agent')


def receive_block(s):
    buf = b''
    while b'\r\n\r\n' not in buf and len(buf) < 16384:
        part = s.recv(4096)
        if not part:
            break
        buf += part
    return buf.decode('utf-8', 'replace')


def originate_internal_only():
    secret = AMI_SECRET_PATH.read_text('utf-8').strip()
    if not secret:
        raise RuntimeError('Credencial AMI ausente')
    with socket.create_connection(('127.0.0.1', 5038), timeout=7) as s:
        s.settimeout(7)
        intro = b''
        while b'\n' not in intro and len(intro) < 4096:
            part = s.recv(512)
            if not part:
                raise RuntimeError('AMI desconectou antes do login')
            intro += part
        s.sendall(('Action: Login\r\nUsername: central_piloto\r\nSecret: ' + secret + '\r\nEvents: off\r\n\r\n').encode())
        r = receive_block(s)
        if 'Response: Success' not in r:
            raise RuntimeError('AMI recusou login')
        # Fixed route. No untrusted number from remote network is ever dialed.
        msg = ('Action: Originate\r\n'
               'ActionID: central-motor-interno\r\n'
               'Channel: PJSIP/1001\r\n'
               'Context: central-interna\r\n'
               'Exten: 600\r\n'
               'Priority: 1\r\n'
               'Timeout: 20000\r\n'
               'Async: true\r\n\r\n')
        s.sendall(msg.encode())
        r = receive_block(s)
        if 'Response: Success' not in r:
            raise RuntimeError('AMI recusou Originate')
        return 'AMI aceitou Originate; atendimento ainda não confirmado'


def api(path, token, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = Request(ENDPOINT + path, data=data, headers={
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'User-Agent': 'central-motor-agent/0.1',
    }, method='GET' if data is None else 'POST')
    with urlopen(req, timeout=12) as resp:
        return json.loads(resp.read(1048576))


def validate_job(job):
    if not isinstance(job, dict):
        return False
    return (isinstance(job.get('id'), str) and 0 < len(job['id']) < 200 and
            job.get('kind') == 'internal_echo_1001' and
            hmac.compare_digest(str(job.get('channel', '')), 'PJSIP/1001') and
            hmac.compare_digest(str(job.get('exten', '')), '600'))


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [central-agent] %(message)s')
    token = MOTOR_TOKEN_PATH.read_text('utf-8').strip()
    if len(token) < 32:
        raise RuntimeError('Token de acesso do motor ausente ou fraco')
    LOG.info('Agente piloto iniciado — apenas chamadas internas 1001 -> 600')
    while True:
        try:
            reply = api('/api/agent/poll', token)
            job = reply.get('job')
            if job:
                if not validate_job(job):
                    LOG.warning('Job nao autorizado ignorado')
                else:
                    try:
                        description = originate_internal_only()
                        outcome = 'accepted'
                    except (OSError, RuntimeError) as exc:
                        description = str(exc)[:150]
                        outcome = 'failed'
                    LOG.info('Teste local %s: %s', job['id'], outcome)
                    api('/api/agent/report', token, {'id': job['id'], 'outcome': outcome, 'detail': description})
            time.sleep(4)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            LOG.warning('Conexao/consulta indisponivel (%s), repetindo', type(exc).__name__)
            time.sleep(20)


if __name__ == '__main__':
    main()