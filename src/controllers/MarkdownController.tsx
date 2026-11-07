import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ReactMarkdownWrapper } from '../components/ReactMarkdownWrapper';
import { MarkdownComponent } from '../parser/types';
import { getStaticAssetByPath } from '../utils/getStaticAsset';
import { ResourceNotFound } from '../ResourceNotFound';
import { PREFIX } from '../utils/Prefix';

export function MarkdownController({ currentConfig }: { currentConfig: MarkdownComponent; }) {
  const [searchParams] = useSearchParams();
  const assetPath = currentConfig.path === 'HAIC_study/assets/introduction.md' && searchParams.has('PROLIFIC_PID')
    ? 'HAIC_study/assets/introduction_prolific.md'
    : currentConfig.path;
  const [importedText, setImportedText] = useState<string>('');

  const [loading, setLoading] = useState(true);
  useEffect(() => {
    async function fetchImage() {
      const asset = await getStaticAssetByPath(`${PREFIX}${assetPath}`);
      if (asset !== undefined) {
        setImportedText(asset);
      }
      setLoading(false);
    }

    fetchImage();
  }, [assetPath]);

  return loading || importedText
    ? <ReactMarkdownWrapper text={importedText} />
    : <ResourceNotFound path={assetPath} />;
}
