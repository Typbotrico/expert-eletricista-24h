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
if __name__=='__main__': unittest.main()
