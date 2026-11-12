import { expect, test } from 'vitest';
import { iframeInteractionEvent } from '../../utils/iframeInteractionEvents';

const timestamp = '2026-11-12T09:00:00Z';
const frame = { left: 320, top: 80 };

test('iframe mouse events are translated into native parent-viewport coordinates', () => {
  for (const [type, nativeType] of [['mouseMove', 'mousemove'], ['mouseDown', 'mousedown'], ['mouseUp', 'mouseup']]) {
    expect(iframeInteractionEvent({ type, timestamp, data: { x: 40, y: 25 } }, frame)).toEqual([Date.parse(timestamp), nativeType, [360, 105]]);
  }
});

test('keyboard forwarding retains actions but not character content', () => {
  expect(iframeInteractionEvent({ type: 'keyDown', timestamp, data: { category: 'character', action: 'a', key: 'a' } }, frame)).toEqual([Date.parse(timestamp), 'keydown', 'character']);
  expect(iframeInteractionEvent({ type: 'keyUp', timestamp, data: { category: 'navigation', action: 'ArrowLeft' } }, frame)).toEqual([Date.parse(timestamp), 'keyup', 'ArrowLeft']);
});

test('invalid and non-native events are ignored', () => {
  for (const message of [null, {}, { type: 'mouseMove', timestamp, data: { x: NaN, y: 2 } }, { type: 'mouseMove', timestamp: 'invalid', data: { x: 1, y: 2 } }, { type: 'aiSuggestion', timestamp, data: {} }]) {
    expect(iframeInteractionEvent(message, frame)).toBeNull();
  }
});

test('visibility events use the native format', () => {
  expect(iframeInteractionEvent({ type: 'visibilityChanged', timestamp, data: { hidden: true } }, frame)).toEqual([Date.parse(timestamp), 'visibility', 'hidden']);
});
