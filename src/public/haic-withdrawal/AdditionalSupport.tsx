import { Checkbox, Radio, Stack, Text, Textarea, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { StimulusParams } from '../../store/types';
import { useIsAnalysis } from '../../store/hooks/useIsAnalysis';
import { supportReasons, supportTypes, toggleSupportChoice } from './additionalSupportOptions';

export default function AdditionalSupport({ setAnswer, answers }: StimulusParams<undefined>) {
  const saved = Object.values(answers).find((answer) => Object.hasOwn(answer.answer, 'additional-support-used'))?.answer;
  const isAnalysis = useIsAnalysis();
  const [used, setUsed] = useState<string | null>(() => typeof saved?.['additional-support-used'] === 'string' && saved['additional-support-used'] ? saved['additional-support-used'] : null);
  const [reasons, setReasons] = useState<string[]>(() => Array.isArray(saved?.['additional-support-reasons']) ? saved['additional-support-reasons'].filter((value): value is string => typeof value === 'string') : []);
  const [types, setTypes] = useState<string[]>(() => Array.isArray(saved?.['additional-support-types']) ? saved['additional-support-types'].filter((value): value is string => typeof value === 'string') : []);
  const [other, setOther] = useState(() => typeof saved?.['additional-support-other'] === 'string' ? saved['additional-support-other'] : '');
  const game = Object.values(answers).find((answer) => answer.componentName === 'mastermind-part');
  const aiCondition = game?.answer.mastermindGame_condition === 'advisor' || game?.answer.mastermindGame_condition === 'judge';

  useEffect(() => {
    if (isAnalysis) return;
    setAnswer({
      status: used !== null,
      provenanceGraph: undefined,
      answers: {
        'additional-support-used': used || '',
        'additional-support-reasons': used === 'yes' ? reasons : [],
        'additional-support-types': used === 'yes' ? types : [],
        'additional-support-other': used === 'yes' && types.includes('other') ? other : '',
      },
    });
  }, [used, reasons, types, other, setAnswer, isAnalysis]);

  function changeUse(value: string) {
    setUsed(value);
    if (value !== 'yes') { setReasons([]); setTypes([]); setOther(''); }
  }

  return (
    <Stack gap="xl" style={{ maxWidth: 960, width: '100%', margin: '0 auto' }}>
      <Title order={2}>Additional support</Title>
      <Radio.Group
        label="During the four games in this session, did you use any additional support beyond what was provided within the study?"
        description="Your answer will not affect your payment. There is no penalty for reporting additional support, so please answer honestly."
        value={used || ''}
        onChange={changeUse}
        required
      >
        <Stack gap="sm" mt="md">
          <Radio value="yes" label="Yes" disabled={isAnalysis} />
          <Radio value="no" label="No" disabled={isAnalysis} />
          <Radio value="prefer_not_to_say" label="Prefer not to answer" disabled={isAnalysis} />
        </Stack>
      </Radio.Group>
      {used === 'yes' && (
        <>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600 }}>What led you to use additional support during this session?</legend>
            <Text size="sm" c="dimmed" mb="md">Please select all that apply. This question is optional.</Text>
            <Stack gap="sm">
              {supportReasons.filter((option) => aiCondition || option.value !== 'previous_ai_performance').map((option) => (
                <Checkbox key={option.value} label={option.label} disabled={isAnalysis} checked={reasons.includes(option.value)} onChange={() => setReasons((values) => toggleSupportChoice(values, option.value))} />
              ))}
              <Checkbox label="Prefer not to say" disabled={isAnalysis} checked={reasons.includes('prefer_not_to_say')} onChange={() => setReasons((values) => toggleSupportChoice(values, 'prefer_not_to_say'))} />
            </Stack>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600 }}>What additional support did you use?</legend>
            <Text size="sm" c="dimmed" mb="md">Please select all that apply. This question is optional.</Text>
            <Stack gap="sm">
              {supportTypes.map((option) => (
                <Checkbox key={option.value} label={option.label} disabled={isAnalysis} checked={types.includes(option.value)} onChange={() => {
                  const next = toggleSupportChoice(types, option.value);
                  setTypes(next);
                  if (!next.includes('other')) setOther('');
                }} />
              ))}
              <Checkbox label="Prefer not to answer" disabled={isAnalysis} checked={types.includes('prefer_not_to_say')} onChange={() => { setTypes((values) => toggleSupportChoice(values, 'prefer_not_to_say')); setOther(''); }} />
              {types.includes('other') && <Textarea label="Please specify the other support (optional)" readOnly={isAnalysis} value={other} onChange={(event) => setOther(event.currentTarget.value)} autosize minRows={2} maxRows={4} />}
            </Stack>
          </fieldset>
        </>
      )}
    </Stack>
  );
}
