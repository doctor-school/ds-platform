import { MediaDropzone } from '@ds/design-system';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'] as const;

const PREVIEW =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI4MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjMWQ0ZWQ4Ii8+PC9zdmc+';

const LABELS = {
  prompt: 'Перетащите обложку вебинара или выберите файл',
  hint: 'JPEG, PNG или WebP · до 10 МБ · до 6000 px по стороне',
  remove: 'убрать',
  previewAlt: 'Текущая обложка',
};

const noop = () => undefined;

export const Empty = () => (
  <div style={{ width: 420 }}>
    <MediaDropzone id="cover-empty" accept={ACCEPT} maxBytes={10 * 1024 * 1024} onFileChange={noop} labels={LABELS} />
  </div>
);

export const Filled = () => (
  <div style={{ width: 420 }}>
    <MediaDropzone
      id="cover-filled"
      accept={ACCEPT}
      maxBytes={10 * 1024 * 1024}
      currentUrl={PREVIEW}
      onFileChange={noop}
      onRemoveCurrent={noop}
      labels={LABELS}
    />
  </div>
);

export const Disabled = () => (
  <div style={{ width: 420 }}>
    <MediaDropzone
      id="cover-disabled"
      accept={ACCEPT}
      maxBytes={10 * 1024 * 1024}
      onFileChange={noop}
      labels={LABELS}
      disabled
    />
  </div>
);
