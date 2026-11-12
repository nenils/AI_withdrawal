import { EventType } from '../store/types';

// Game coordinates are local to the iframe; reVISit's native events use the parent viewport.
export function iframeInteractionEvent(message: unknown, frame: Pick<DOMRect, 'left' | 'top'>): EventType | null {
  if (!message || typeof message !== 'object') return null;
  const { type, timestamp, data } = message as { type?: string; timestamp?: string; data?: Record<string, unknown> };
  if (!data || typeof data !== 'object' || typeof timestamp !== 'string') return null;
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return null;
  if (type === 'mouseMove' || type === 'mouseDown' || type === 'mouseUp') {
    if (typeof data.x !== 'number' || typeof data.y !== 'number' || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return null;
    const nativeType = type === 'mouseMove' ? 'mousemove' : type === 'mouseDown' ? 'mousedown' : 'mouseup';
    return [time, nativeType, [data.x + frame.left, data.y + frame.top]];
  }
  if (type === 'keyDown' || type === 'keyUp') {
    // Never forward typed characters, even if an iframe message contains one.
    const safeActions = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete', 'Insert', 'Enter', 'Escape', 'Tab', 'Space'];
    const action = typeof data.action === 'string' && safeActions.includes(data.action) ? data.action : null;
    const category = ['character', 'modifier', 'navigation', 'editing', 'action', 'function', 'other'].includes(String(data.category)) ? String(data.category) : 'other';
    return [time, type === 'keyDown' ? 'keydown' : 'keyup', action || category];
  }
  if (type === 'visibilityChanged' && typeof data.hidden === 'boolean') return [time, 'visibility', data.hidden ? 'hidden' : 'visible'];
  return null;
}
