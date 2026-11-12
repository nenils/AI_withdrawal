import {
  useCallback, useEffect, useMemo, useRef,
} from 'react';
import { useDispatch } from 'react-redux';
import { useCurrentComponent, useCurrentIdentifier } from '../routes/utils';
import { useStoreDispatch, useStoreActions, useStoreSelector } from '../store/store';
import { ParticipantData, WebsiteComponent } from '../parser/types';
import { PREFIX as BASE_PREFIX } from '../utils/Prefix';
import { useStorageEngine } from '../storage/storageEngineHooks';
import { useWindowEvents } from '../store/hooks/useWindowEvents';
import { useIsAnalysis } from '../store/hooks/useIsAnalysis';
import { iframeInteractionEvent } from '../utils/iframeInteractionEvents';

const PREFIX = '@REVISIT_COMMS';

export function IframeController({ currentConfig, provState, answers }: { currentConfig: WebsiteComponent; provState?: unknown, answers: ParticipantData['answers'] }) {
  const {
    setReactiveAnswers, updateResponseBlockValidation,
  } = useStoreActions();
  const storeDispatch = useStoreDispatch();
  const dispatch = useDispatch();
  const identifier = useCurrentIdentifier();
  const participantId = useStoreSelector((state) => state.participantId);
  const allAnswers = useStoreSelector((state) => state.answers);
  const { storageEngine } = useStorageEngine();
  const windowEvents = useWindowEvents();
  const isAnalysis = useIsAnalysis();

  const ref = useRef<HTMLIFrameElement>(null);

  const iframeId = useMemo(
    () => (crypto.randomUUID ? crypto.randomUUID() : `testID-${Date.now()}`),
    [],
  );

  // navigation
  const currentComponent = useCurrentComponent();

  const sendMessage = useCallback(
    (tag: string, message: unknown) => {
      ref.current?.contentWindow?.postMessage(
        {
          error: false,
          type: `${PREFIX}/${tag}`,
          iframeId,
          message,
        },
        '*',
      );
    },
    [ref, iframeId],
  );

  useEffect(() => {
    if (provState) {
      sendMessage('PROVENANCE', provState);
    }
  }, [provState, sendMessage]);

  useEffect(() => {
    if (answers) {
      sendMessage('ANSWERS', answers);
    }
  }, [answers, sendMessage]);

  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      const { data } = e;
      if (typeof data === 'object' && iframeId === data.iframeId) {
        switch (data.type) {
          case `${PREFIX}/INTERACTION_EVENT`: {
            if (isAnalysis || !currentConfig.path.endsWith('mastermind_withdrawal.html')
              || e.origin !== window.location.origin || e.source !== ref.current?.contentWindow) break;
            const frame = ref.current?.getBoundingClientRect();
            const event = frame ? iframeInteractionEvent(data.message, frame) : null;
            if (event && windowEvents && 'current' in windowEvents && windowEvents.current) windowEvents.current.push(event);
            break;
          }
          case `${PREFIX}/WINDOW_READY`:
            if (currentConfig.path.endsWith('sona_completion.html') && storageEngine) {
              try {
                await storageEngine.saveAnswers(allAnswers);
                await storageEngine.flushAnswers();
              } catch {
                sendMessage('STUDY_DATA', { ...(currentConfig.parameters || {}), __revisit: { participantId, persistenceError: true } });
                break;
              }
            }
            sendMessage('STUDY_DATA', {
              ...(currentConfig.parameters || {}),
              __revisit: {
                participantId,
                component: currentComponent,
                identifier,
              },
            });
            break;
          case `${PREFIX}/READY`:
            break;
          case `${PREFIX}/ANSWERS`:
            storeDispatch(setReactiveAnswers(data.message));
            storeDispatch(updateResponseBlockValidation({
              location: 'stimulus',
              identifier,
              status: true,
              values: data.message,
            }));
            break;
          case `${PREFIX}/PROVENANCE`:
            storeDispatch(updateResponseBlockValidation({
              location: 'stimulus',
              identifier,
              values: {},
              status: true,
              provenanceGraph: data.message,
            }));
            break;
          default:
            break;
        }
      }
    };

    window.addEventListener('message', handler);

    return () => window.removeEventListener('message', handler);
  }, [storeDispatch, dispatch, iframeId, currentConfig, sendMessage, setReactiveAnswers, updateResponseBlockValidation, identifier, participantId, currentComponent, storageEngine, allAnswers, isAnalysis, windowEvents]);

  return (
    <iframe
      ref={ref}
      style={{ width: '100%', flexGrow: 1, border: 0 }}
      src={
        currentConfig.path.startsWith('http')
          ? currentConfig.path
          : `${BASE_PREFIX}${currentConfig.path}?trialid=${currentComponent}&id=${iframeId}`
      }
    />
  );
}
