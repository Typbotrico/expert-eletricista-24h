import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('agent',Path(__file__).with_name('agent.py'))
agent=importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

class TestAgent(unittest.TestCase):
    def test_only_internal(self):
        good={'id':'123','kind':'internal_echo_1001','channel':'PJSIP/1001','exten':'600'}
        self.assertTrue(agent.validate_job(good))
        for bad in [dict(good,kind='pstn'),dict(good,channel='PJSIP/11999999999@directcall-out'),dict(good,exten='700'),dict(good,id=''*1),{}]:
            self.assertFalse(agent.validate_job(bad))

if __name__=='__main__':unittest.main()