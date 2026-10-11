import { JumpFunctionParameters, JumpFunctionReturnVal } from '../../store/types';

export default function willingness({ answers, currentBlock, currentStep }: JumpFunctionParameters<never>): JumpFunctionReturnVal {
  const completed = Object.entries(answers).some(([key, value]) => (
    key.startsWith(`${currentBlock}_${currentStep}_`) && value.endTime > -1
  ));
  if (completed) return { component: null };

  const game = Object.values(answers).find((value) => value.componentName === 'mastermind-part');
  const condition = game?.answer.mastermindGame_condition;
  return { component: condition === 'advisor' || condition === 'judge' ? '$haic-withdrawal.components.control-trust-willingness' : null };
}
