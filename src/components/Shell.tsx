import {
  ReactNode,
  useEffect,
  useState,
  useMemo,
} from 'react';
import { Provider } from 'react-redux';
import { RouteObject, useRoutes, useSearchParams } from 'react-router';
import { Button, LoadingOverlay, Title, Text } from '@mantine/core';
import {
  GlobalConfig,
  Nullable,
  ParsedConfig,
  StudyConfig,
} from '../parser/types';
import { useStudyId } from '../routes/utils';
import {
  StudyStoreContext,
  StudyStore,
  studyStoreCreator,
} from '../store/store';

import { ComponentController } from '../controllers/ComponentController';
import { NavigateWithParams } from '../utils/NavigateWithParams';
import { StepRenderer } from './StepRenderer';
import { useStorageEngine } from '../storage/storageEngineHooks';
import { generateSequenceArray } from '../utils/handleRandomSequences';
import { getStudyConfig } from '../utils/fetchConfig';
import { ParticipantMetadata } from '../store/types';
import { ErrorLoadingConfig } from './ErrorLoadingConfig';
import { ResourceNotFound } from '../ResourceNotFound';
import { encryptIndex } from '../utils/encryptDecryptIndex';
import { parseStudyConfig } from '../parser/parser';
import { hash } from '../storage/engines/utils';
import { withdrawalPartStatus } from '../storage/withdrawalPartStatus';

async function fetchParticipantIp() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 1500);

  try {
    const ipRes = await fetch('https://api.ipify.org?format=json', {
      signal: controller.signal,
    });
    return await ipRes.json() as { ip: string };
  } catch (_) {
    return { ip: '' };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function Shell({ globalConfig }: { globalConfig: GlobalConfig }) {
  // Pull study config
  const studyId = useStudyId();
  const [activeConfig, setActiveConfig] = useState<ParsedConfig<StudyConfig> | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [partLock, setPartLock] = useState<{ participantId: string; part: number; credited: boolean } | null>(null);
  const [creditRetrying, setCreditRetrying] = useState(false);
  const isValidStudyId = globalConfig.configsList.includes(studyId) || studyId === '__revisit-widget';

  useEffect(() => {
    if (studyId !== '__revisit-widget') {
      getStudyConfig(studyId, globalConfig).then((config) => {
        setActiveConfig(config);
      });
      return () => {};
    }
    if (globalConfig && studyId) {
      const messageListener = (event: MessageEvent) => {
        if (event.data.type === 'revisitWidget/CONFIG') {
          parseStudyConfig(event.data.payload).then(async (config) => {
            setActiveConfig(config);
            const sequenceArray = await generateSequenceArray(config);
            window.parent.postMessage({ type: 'revisitWidget/SEQUENCE_ARRAY', payload: sequenceArray }, '*');
          });
        }
      };

      window.addEventListener('message', messageListener);

      window.parent.postMessage({ type: 'revisitWidget/READY' }, '*');

      return () => {
        window.removeEventListener('message', messageListener);
      };
    }
    return () => {};
  }, [globalConfig, studyId]);

  const [routes, setRoutes] = useState<RouteObject[]>([]);
  const [store, setStore] = useState<Nullable<StudyStore>>(null);
  const { storageEngine } = useStorageEngine();
  const [searchParams] = useSearchParams();

  const participantId = useMemo(() => searchParams.get('participantId'), [searchParams]);

  useEffect(() => {
    async function initializeUserStoreRouting() {
      // Check that we have a storage engine and active config (studyId is set for config, but typescript complains)
      if (!storageEngine || !activeConfig || !studyId) return;

      try {
        setStartupError(null);
        setPartLock(null);
        setRoutes([]);
        setStore(null);

        const linkedId = participantId || (activeConfig.uiConfig.urlParticipantIdParam
          ? searchParams.get(activeConfig.uiConfig.urlParticipantIdParam) : null);
        if (storageEngine.getEngine() === 'supabase' && /^HAIC_part_[1-4]$/.test(studyId) && linkedId) {
          const part = Number(studyId.slice(-1));
          const status = await withdrawalPartStatus(linkedId, part, true);
          if (status.locked) {
            setPartLock({ participantId: linkedId, part, credited: status.credited });
            return;
          }
        }

        // Make sure that we have a study database and that the study database has a sequence array
        await storageEngine.initializeStudyDb(studyId);
        await storageEngine.saveConfig(activeConfig);

        const sequenceArray = await storageEngine.getSequenceArray();
        if (!sequenceArray) {
          await storageEngine.setSequenceArray(
            await generateSequenceArray(activeConfig),
          );
        }

        // Get or generate participant session
        const urlParticipantId = activeConfig.uiConfig.urlParticipantIdParam
          ? searchParams.get(activeConfig.uiConfig.urlParticipantIdParam)
            || undefined
          : undefined;
        const searchParamsObject = Object.fromEntries(searchParams.entries());

        const ip = await fetchParticipantIp();

        const metadata: ParticipantMetadata = {
          language: navigator.language,
          userAgent: navigator.userAgent,
          resolution: {
            width: window.screen.width,
            height: window.screen.height,
            availHeight: window.screen.availHeight,
            availWidth: window.screen.availWidth,
            colorDepth: window.screen.colorDepth,
            orientation: window.screen.orientation.type,
            pixelDepth: window.screen.pixelDepth,
          },
          ip: ip.ip,
        };

        const participantSession = await storageEngine.initializeParticipantSession(
          searchParamsObject,
          activeConfig,
          metadata,
          participantId || urlParticipantId,
        );

        const modes = await storageEngine.getModes(studyId);
        const activeHash = await hash(JSON.stringify(activeConfig));

        let participantConfig = activeConfig;

        if (participantSession.participantConfigHash !== activeHash) {
          participantConfig = (await storageEngine.getAllConfigsFromHash([participantSession.participantConfigHash], studyId))[participantSession.participantConfigHash] as ParsedConfig<StudyConfig>;
        }

        // Initialize the redux stores
        const newStore = await studyStoreCreator(
          studyId,
          participantConfig,
          participantSession.sequence,
          metadata,
          participantSession.answers,
          modes,
          participantSession.participantId,
        );
        setStore(newStore);

        // Initialize the routing
        setRoutes([
          {
            element: <StepRenderer />,
            children: [
              {
                path: '/',
                element: <NavigateWithParams to={encryptIndex(0)} replace />,
              },
              {
                path: '/:index/:funcIndex?',
                element:
                  activeConfig.errors.length > 0 ? (
                    <>
                      <Title order={2} mb={8}>
                        Error loading config
                      </Title>
                      <ErrorLoadingConfig
                        issues={activeConfig.errors}
                        type="error"
                      />
                    </>
                  ) : (
                    <ComponentController />
                  ),
              },
            ],
          },
        ]);
      } catch (error) {
        console.error('Error initializing study route', error);
        setStartupError(error instanceof Error ? error.message : String(error));
      }
    }
    initializeUserStoreRouting();
  }, [storageEngine, activeConfig, studyId, searchParams, participantId]);

  const routing = useRoutes(routes);

  let toRender: ReactNode = null;

  // Definitely a 404
  if (!isValidStudyId) {
    toRender = <ResourceNotFound />;
  } else if (partLock) {
    toRender = (
      <div style={{ padding: 24 }}>
        <Title order={2} mb={8}>{partLock.credited ? 'You have already completed this session.' : 'Your answers have been submitted.'}</Title>
        <Text>Your recorded answers will not be changed.</Text>
        {!partLock.credited && (
          <Button mt="md" loading={creditRetrying} onClick={async () => {
            setCreditRetrying(true);
            setStartupError(null);
            try {
              const response = await fetch('/api/sona/complete-part', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantId: partLock.participantId, partNumber: partLock.part }),
              });
              if (!response.ok) throw new Error('Credit could not be confirmed. Please retry without closing this tab.');
              setPartLock({ ...partLock, credited: true });
            } catch (error) {
              setStartupError(error instanceof Error ? error.message : String(error));
            } finally {
              setCreditRetrying(false);
            }
          }}>Retry credit confirmation</Button>
        )}
        {startupError && <Text c="red" mt="md">{startupError}</Text>}
      </div>
    );
  } else if (startupError) {
    toRender = (
      <div style={{ padding: 24 }}>
        <Title order={2} mb={8}>Error starting study</Title>
        <p>{startupError}</p>
      </div>
    );
  } else if (routes.length === 0) {
    toRender = <LoadingOverlay visible />;
  } else {
    // If routing is null, we didn't match any routes
    toRender = routing && store ? (
      <StudyStoreContext.Provider value={store}>
        <Provider store={store.store}>{routing}</Provider>
      </StudyStoreContext.Provider>
    ) : (
      <ResourceNotFound />
    );
  }
  return toRender;
}
