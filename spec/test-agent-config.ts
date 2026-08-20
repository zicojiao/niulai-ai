import assert from 'node:assert/strict';
import { Agent, AgoraClient, Area, DeepgramSTT, OpenAI } from 'agora-agents';
import { createFishAudioTts } from '../lib/fishAudio';
import { isPersonaId, PERSONAS } from '../lib/personas';

const persona = PERSONAS.niulai;
const agent = new Agent({
  client: new AgoraClient({
    area: Area.US,
    appId: '0'.repeat(32),
    appCertificate: '1'.repeat(32),
  }),
  turnDetection: {
    language: persona.language,
    config: {
      speech_threshold: 0.5,
      start_of_speech: {
        mode: 'vad',
        vad_config: {
          interrupt_duration_ms: 160,
          prefix_padding_ms: 300,
        },
      },
      end_of_speech: {
        mode: 'vad',
        vad_config: {
          silence_duration_ms: 480,
        },
      },
    },
  },
  advancedFeatures: { enable_rtm: true, enable_tools: true },
  parameters: {
    audio_scenario: 'chorus',
    data_channel: 'rtm',
    enable_error_message: true,
    enable_metrics: true,
  },
})
  .withStt(new DeepgramSTT({ model: 'nova-2', language: persona.language }))
  .withLlm(
    new OpenAI({
      model: 'gpt-4o-mini',
      systemMessages: [{ role: 'system', content: persona.prompt }],
      greetingMessage: persona.greetings[0],
    }),
  )
  .withTts(createFishAudioTts('test-fish-key'));

const properties = agent.toProperties({
  token: 'test-token',
  channel: 'test-channel',
  agentUid: '123456',
  remoteUids: ['654321'],
});
const serialized = JSON.parse(JSON.stringify(properties)) as {
  turn_detection?: { language?: string };
  asr?: { language?: string; params?: { language?: string } };
  advanced_features?: { enable_rtm?: boolean };
  parameters?: { enable_error_message?: boolean; enable_metrics?: boolean };
};

assert.equal(serialized.turn_detection?.language, 'zh-CN');
assert.equal(serialized.asr?.language, 'zh-CN');
assert.equal(serialized.asr?.params?.language, 'zh-CN');
assert.equal(serialized.advanced_features?.enable_rtm, true);
assert.equal(serialized.parameters?.enable_error_message, true);
assert.equal(serialized.parameters?.enable_metrics, true);

const englishPersona = PERSONAS['niulai-en'];
assert.equal(englishPersona.language, 'en-US');
assert.match(englishPersona.prompt, /Speak English by default/);
assert.match(englishPersona.greetings[0], /Niu Lai/);
assert.equal(isPersonaId('niulai-en'), true);

console.log('Niulai agent language contract checks passed.');
