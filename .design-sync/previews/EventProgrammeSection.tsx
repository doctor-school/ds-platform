import { EventProgrammeSection } from '@ds/design-system';

export const WithPdf = () => (
  <div style={{ width: 640 }}>
    <EventProgrammeSection
      heading="Программа"
      downloadLabel="Скачать программу (PDF)"
      downloadHref="#program.pdf"
    />
  </div>
);

export const NoPdfStatement = () => (
  <div style={{ width: 640 }}>
    <EventProgrammeSection
      heading="Программа"
      downloadLabel="Скачать программу (PDF)"
      statement="Программу опубликуем ближе к дате события."
    />
  </div>
);
