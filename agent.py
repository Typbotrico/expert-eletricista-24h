#!/usr/bin/env python3
"""Fixed-route internal pilot agent. No PSTN numbers or inbound listener."""
import argparse
import fcntl
import getpass
import hashlib
import subprocess
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
VERSION = '0.7.0'
POLICY={'phones':[],'revision':''}


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
    if not isinstance(job, dict):
        return False
    ids_ok=all(re.fullmatch(r'[a-f0-9-]{36}',str(job.get(k,''))) for k in ('id','lease'))
    if job.get('kind')=='campaign_call':
        route=local_route()
        return bool(ids_ok and job.get('channel')=='PJSIP/1001' and job.get('maxSeconds')==180 and job.get('policyRevision')==POLICY.get('revision') and job.get('targetPhone') in POLICY.get('phones',[]) and route and valid_template(route))
    if job.get('kind')=='external_pilot_700':
        route=local_route()
        return bool(ids_ok and job.get('channel')=='PJSIP/1001' and job.get('context')=='central-interna' and job.get('exten')=='700' and job.get('maxSeconds')==180 and route and job.get('routeHash')==route.get('phoneHash'))
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


def ami_probe():
    """Check loopback AMI login without originating a call or changing Asterisk."""
    try:
        secret = (CONFIG / 'ami.secret').read_text().strip()
        with socket.create_connection(('127.0.0.1', 5038), timeout=3) as connection:
            connection.settimeout(3)
            AMI(connection).login(secret)
        return True
    except Exception:
        return False


def extract_route(output):
    targets = re.findall(r'\bDial\(\s*PJSIP/([^,\s)]+)', output, re.I)
    if len(targets)!=1 or any(ch in targets[0] for ch in ('$','{','}','&')):
        raise ValueError('A rota 700 precisa conter um único destino fixo PJSIP.')
    target=targets[0]
    direct=re.fullmatch(r'(\+?[0-9]+)@[A-Za-z0-9_.-]+',target)
    uri=re.fullmatch(r'[A-Za-z0-9_.-]+/sip:(\+?[0-9]+)@[A-Za-z0-9_.:-]+',target)
    match=direct or uri
    if not match:
        raise ValueError('Formato da rota 700 não reconhecido; nenhuma chamada liberada.')
    phone=match.group(1).lstrip('+')
    if len(phone) in (10,11):phone='55'+phone
    if not re.fullmatch(r'55[1-9]\d\d{8,9}',phone):
        raise ValueError('Destino da rota 700 não é um telefone brasileiro válido.')
    return {'phoneHash':hashlib.sha256(phone.encode()).hexdigest(),'context':'central-interna','extension':'700','dialTemplate':'PJSIP/'+target.replace(match.group(1),'{number}',1),'numberFormat':'national' if len(match.group(1).lstrip('+')) in (10,11) else 'international'}


def valid_template(route):
    target=route.get('dialTemplate','')
    return bool(re.fullmatch(r'PJSIP/(?:\{number\}@[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+/sip:\{number\}@[A-Za-z0-9_.:-]+)',target) and route.get('numberFormat') in ('national','international'))


def dial_target(route,phone):
    if not valid_template(route) or not re.fullmatch(r'55[1-9]\d\d{8,9}',str(phone)):
        raise ValueError('Destino ou tronco fora da configuração validada')
    return route['dialTemplate'].replace('{number}',phone[2:] if route['numberFormat']=='national' else phone)


def local_route():
    try:
        value=json.loads((CONFIG/'route.json').read_text())
        if value.get('context')!='central-interna' or value.get('extension')!='700' or not re.fullmatch('[a-f0-9]{64}',value.get('phoneHash','')):return None
        return value
    except Exception:return None


def configure_route():
    try:
        result=subprocess.run(['asterisk','-rx','dialplan show 700@central-interna'],capture_output=True,text=True,timeout=10,check=True)
        atomic(CONFIG/'route.json',extract_route(result.stdout))
        print('Rota local 700 validada. O servidor só aceitará o número de teste previamente autorizado.')
    except Exception:
        (CONFIG/'route.json').unlink(missing_ok=True)
        print('Rota 700 não pôde ser validada automaticamente. Testes externos continuam bloqueados; teste interno preservado.')


class ExternalCall:
    def __init__(self,job,emit,clock=time.monotonic):
        self.job=job;self.emit=emit;self.clock=clock;self.started=clock()
        self.channel_id='central-'+job['id'];self.dest=None;self.operator_answered=False
        self.contact_answered=False;self.bridged=False;self.done=None;self.terminal_candidate=None;self.bridges={};self.sent=set();self.operator_channel=None
    def progress(self,phase,proof):
        if phase in self.sent:return
        self.sent.add(phase);self.emit(phase,proof,int((self.clock()-self.started)*1000))
    def maybe_bridge(self):
        if self.contact_answered:
            for bridge,ids in self.bridges.items():
                if self.channel_id in ids and self.dest in ids:
                    self.bridged=True
                    self.progress('bridged',{'event':'BridgeEnter','operatorUniqueId':self.channel_id,'destUniqueId':self.dest,'bridgeId':bridge})
    def feed(self,e):
        kind=e.get('Event');uid=e.get('Uniqueid');action=e.get('ActionID')
        if uid==self.channel_id and re.fullmatch(r'PJSIP/1001-[A-Za-z0-9]+',e.get('Channel','')):self.operator_channel=e['Channel']
        if kind=='Newstate' and uid==self.channel_id and e.get('ChannelState')=='6':
            self.operator_answered=True;self.progress('operator_answered',{'event':'Newstate','uniqueId':uid,'channelState':'6'})
        if action==self.job['id'] and kind=='OriginateResponse':
            if e.get('Response')=='Failure':self.done='operator_no_answer' if not self.operator_answered else 'failed'
            elif e.get('Response')=='Success' and e.get('Reason')=='4':
                self.operator_answered=True;self.progress('operator_answered',{'event':kind,'actionId':action,'response':'Success','reason':'4'})
        if action==self.job['id'] and e.get('Response')=='Error':self.done='failed'
        if kind=='DialBegin' and uid==self.channel_id and e.get('DestUniqueid'):
            self.dest=e['DestUniqueid'];self.progress('contact_ringing',{'event':kind,'uniqueId':uid,'destUniqueId':self.dest})
        if kind=='DialEnd' and uid==self.channel_id and self.dest and e.get('DestUniqueid')==self.dest:
            status=e.get('DialStatus')
            if status=='ANSWER':
                self.contact_answered=True;self.progress('contact_answered',{'event':kind,'uniqueId':uid,'destUniqueId':self.dest,'dialStatus':'ANSWER'});self.maybe_bridge()
            else:self.terminal_candidate={'BUSY':'busy','NOANSWER':'no_answer','CANCEL':'no_answer'}.get(status,'failed')
        if kind=='BridgeEnter' and uid in (self.channel_id,self.dest) and e.get('BridgeUniqueid'):
            self.bridges.setdefault(e['BridgeUniqueid'],set()).add(uid);self.maybe_bridge()
        if kind=='Hangup' and uid in (self.channel_id,self.dest):
            self.progress('ended',{'event':'Hangup','uniqueId':uid})
            if uid==self.channel_id:self.done='completed' if self.bridged else self.terminal_candidate or ('failed' if self.operator_answered else 'operator_no_answer')
        return self.done


def originate_external(job,mark_sent,emit,connector=socket.create_connection):
    if not allowed_job(job):return 'failed'
    sent=False
    try:
        with connector(('127.0.0.1',5038),timeout=5) as connection:
            connection.settimeout(3);ami=AMI(connection);ami.login((CONFIG/'ami.secret').read_text().strip())
            tracker=ExternalCall(job,emit);mark_sent();sent=True
            action={'Action':'Originate','ActionID':job['id'],'Channel':'PJSIP/1001','Timeout':'20000','Async':'true','ChannelId':tracker.channel_id,'Variable':'TIMEOUT(absolute)=180'}
            if job['kind']=='campaign_call':action.update({'Application':'Dial','Data':dial_target(local_route(),job['targetPhone'])+',45'})
            else:action.update({'Context':'central-interna','Exten':'700','Priority':'1'})
            ami.send(action)
            tracker.progress('operator_ringing',{'event':'Originate','actionId':job['id']})
            deadline=time.monotonic()+210;last_heartbeat=time.monotonic()
            while time.monotonic()<deadline:
                try:
                    outcome=tracker.feed(ami.read())
                    if outcome:return outcome
                except socket.timeout:pass
                if time.monotonic()-last_heartbeat>=10:
                    emit('heartbeat',{},int((time.monotonic()-tracker.started)*1000));last_heartbeat=time.monotonic()
            if tracker.operator_channel:
                ami.send({'Action':'Hangup','ActionID':'stop-'+job['id'],'Channel':tracker.operator_channel})
            return 'unknown'
    except Exception:return 'unknown' if sent else 'failed'


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
    global POLICY
    token = json.loads((CONFIG / 'token.json').read_text())['token']
    journal = json.loads(STATE.read_text()) if STATE.exists() else None
    def send_events():
        if not journal:return
        for event in journal.get('outbox',[]):
            if event['seq']<=journal.get('sentSeq',0):continue
            api('/api/agent/event',token,dict(event,id=journal['job']['id'],lease=journal['job']['lease']))
            journal['sentSeq']=event['seq'];atomic(STATE,journal)
    if journal and journal.get('phase') != 'done':
        journal['outcome'] = journal.get('outcome', 'unknown')
        journal['phase'] = 'report'
        atomic(STATE, journal)
    while True:
        try:
            if journal and journal['phase'] == 'report':
                job = journal['job']
                try:
                    send_events()
                    api('/api/agent/report', token, {'id':job['id'], 'lease':job['lease'], 'outcome':journal['outcome']})
                except urllib.error.HTTPError as error:
                    if error.code != 409:
                        raise
                    # A closed/expired lease is never originated again.
                journal['phase'] = 'done'
                atomic(STATE, journal)
                print('Resultado telefônico registrado: ' + journal['outcome'], flush=True)
            policy=api('/api/agent/policy',token)
            if not isinstance(policy.get('phones'),list) or len(policy['phones'])>10 or any(not re.fullmatch(r'55[1-9]\d\d{8,9}',str(p)) for p in policy['phones']) or not re.fullmatch('[a-f0-9]{64}',policy.get('revision','')):raise ValueError('Política de destinos inválida')
            POLICY=policy
            route=local_route()
            response = api('/api/agent/poll?ami_ready=' + ('1' if ami_probe() else '0') + '&version='+VERSION+'&route_hash='+(route['phoneHash'] if route else '')+'&template_ready='+('1' if route and valid_template(route) else '0')+'&policy_revision='+POLICY['revision'], token)
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
                def emit(phase,proof,elapsed):
                    journal.setdefault('outbox',[]).append({'seq':len(journal.get('outbox',[]))+1,'phase':phase,'proof':proof,'elapsedMs':elapsed})
                    atomic(STATE,journal)
                    try:send_events()
                    except Exception:pass
                journal['outcome'] = originate_external(job,mark_sent,emit) if job['kind']!='internal_echo_1001' else originate(job, mark_sent)
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
    parser.add_argument('--configure-route',action='store_true')
    args = parser.parse_args()
    if args.configure_route:
        configure_route()
    elif args.enroll:
        enroll()
    else:
        run()
