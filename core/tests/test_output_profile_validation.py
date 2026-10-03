"""OutputProfile parameters must use pipe:0/pipe:1 and no stream-profile placeholders."""

from django.test import TestCase

from core.serializers import OutputProfileSerializer


class OutputProfileValidationTests(TestCase):
    def _errors(self, params):
        s = OutputProfileSerializer(data={"name": "x", "command": "ffmpeg", "parameters": params})
        s.is_valid()
        return s.errors.get("parameters")

    def test_valid_pipe_params(self):
        self.assertIsNone(self._errors("-i pipe:0 -c copy -f mpegts pipe:1"))

    def test_rejects_stream_profile_placeholders(self):
        err = self._errors("-user_agent {userAgent} -i {streamUrl} -c copy -f mpegts pipe:1")
        self.assertTrue(err and "placeholders" in err[0])

    def test_rejects_missing_pipes(self):
        err = self._errors("-i pipe:0 -c:v copy -c:a ac3")
        self.assertTrue(err and "pipe:1" in err[0])
