import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('agent', Path(__file__).with_name('agent.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
class Socket:
    def __init__(self, chunks): self.chunks = iter(chunks)
    def recv(self, n): return next(self.chunks, b'')
class Events:
    def __init__(self, events): self.events = iter(events)
    def read(self): return next(self.events)
class AgentTest(unittest.TestCase):
    def test_fragmented_frames_and_multiple_frames(self):
        ami=a.AMI(Socket([b'Asterisk Call Manager/5.0\r\n\r\nResponse: Suc',b'cess\r\nActionID: x\r\n\r\nEvent: Newstate\r\nUniqueid: y\r\n\r\n']))
        self.assertEqual(ami.read(), {})
        self.assertEqual(ami.read()['Response'], 'Success')
        self.assertEqual(ami.read()['Uniqueid'], 'y')
    def test_acceptance_and_unrelated_answer_are_not_answer(self):
        events=Events([{'ActionID':'x','Response':'Success'}, {'Event':'Newstate','Uniqueid':'other','ChannelState':'6'}, {'Event':'OriginateResponse','ActionID':'x','Response':'Failure','Reason':'0'}])
        self.assertEqual(a.observe(events,'x','y',a.time.monotonic()+5), 'no_answer')
    def test_correlated_answer(self):
        self.assertEqual(a.observe(Events([{'Event':'Newstate','Uniqueid':'y','ChannelState':'6'}]),'x','y',a.time.monotonic()+5),'answered')
    def test_external_routes_rejected(self):
        job={'id':str(a.uuid.uuid4()),'lease':str(a.uuid.uuid4()),'kind':'internal_echo_1001','channel':'PJSIP/1001','exten':'600'}
        self.assertTrue(a.allowed_job(job))
        self.assertFalse(a.allowed_job(None))
        self.assertFalse(a.allowed_job('invalid'))
        self.assertFalse(a.allowed_job(dict(job,channel='PJSIP/5511999999999@directcall')))
        self.assertFalse(a.allowed_job(dict(job,exten='5511999999999')))
    def test_ami_injection(self):
        with self.assertRaises(ValueError): a.AMI(None).send({'Secret':'a\r\nAction: Originate'})

class ExternalPilotTest(unittest.TestCase):
    def job(self):
        return {'id':str(a.uuid.uuid4()),'lease':str(a.uuid.uuid4()),'kind':'external_pilot_700','channel':'PJSIP/1001','context':'central-interna','exten':'700','maxSeconds':180,'routeHash':'a'*64}
    def test_fixed_route_parser_rejects_dynamic_or_multiple_destinations(self):
        route=a.extract_route('1. Dial(PJSIP/5524999999999@directcall,60)')
        self.assertEqual(len(route['phoneHash']),64)
        self.assertEqual(route['phoneHash'],a.extract_route('1. Dial(PJSIP/directcall/sip:5524999999999@189.84.133.111:5060,60)')['phoneHash'])
        for value in ('Dial(PJSIP/${NUMBER}@directcall,60)','Dial(PJSIP/5524999999999@directcall&PJSIP/5511999999999@directcall,60)','Dial(PJSIP/5524999999999@directcall) Dial(PJSIP/5511999999999@directcall)'):
            with self.assertRaises(ValueError):a.extract_route(value)
    def test_external_job_requires_matching_local_route_and_fixed_extension(self):
        original=a.local_route
        try:
            a.local_route=lambda:{'phoneHash':'a'*64}
            job=self.job();self.assertTrue(a.allowed_job(job))
            for change in ({'routeHash':'b'*64},{'exten':'701'},{'channel':'PJSIP/other'},{'maxSeconds':999}):self.assertFalse(a.allowed_job(dict(job,**change)))
        finally:a.local_route=original
    def test_operator_answer_is_never_customer_answer_or_completed_call(self):
        job=self.job();events=[];tracker=a.ExternalCall(job,lambda *v:events.append(v));uid=tracker.channel_id
        self.assertIsNone(tracker.feed({'Event':'Newstate','Uniqueid':uid,'ChannelState':'6'}))
        self.assertFalse(tracker.contact_answered);self.assertFalse(tracker.bridged)
        self.assertEqual(tracker.feed({'Event':'Hangup','Uniqueid':uid}),'failed')
    def test_only_correlated_two_leg_bridge_and_operator_hangup_complete(self):
        job=self.job();events=[];tracker=a.ExternalCall(job,lambda *v:events.append(v));uid=tracker.channel_id
        tracker.feed({'Event':'Newstate','Uniqueid':uid,'ChannelState':'6'})
        tracker.feed({'Event':'DialBegin','Uniqueid':uid,'DestUniqueid':'dest'})
        tracker.feed({'Event':'BridgeEnter','Uniqueid':uid,'BridgeUniqueid':'bridge'})
        tracker.feed({'Event':'BridgeEnter','Uniqueid':'dest','BridgeUniqueid':'bridge'})
        self.assertFalse(tracker.bridged)
        tracker.feed({'Event':'DialEnd','Uniqueid':uid,'DestUniqueid':'dest','DialStatus':'ANSWER'})
        self.assertTrue(tracker.bridged)
        self.assertIsNone(tracker.feed({'Event':'Hangup','Uniqueid':'unrelated'}))
        self.assertIsNone(tracker.feed({'Event':'Hangup','Uniqueid':'dest'}))
        self.assertEqual(tracker.feed({'Event':'Hangup','Uniqueid':uid}),'completed')
        self.assertEqual([e[0] for e in events],['operator_answered','contact_ringing','contact_answered','bridged','ended'])
    def test_busy_destination_does_not_release_seller_before_hangup(self):
        tracker=a.ExternalCall(self.job(),lambda *v:None);uid=tracker.channel_id
        tracker.feed({'Event':'Newstate','Uniqueid':uid,'ChannelState':'6'})
        tracker.feed({'Event':'DialBegin','Uniqueid':uid,'DestUniqueid':'dest'})
        self.assertIsNone(tracker.feed({'Event':'DialEnd','Uniqueid':uid,'DestUniqueid':'dest','DialStatus':'BUSY'}))
        self.assertEqual(tracker.feed({'Event':'Hangup','Uniqueid':uid}),'busy')

if __name__=='__main__': unittest.main()
