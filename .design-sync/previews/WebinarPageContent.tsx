import { WebinarPageContent } from '@ds/design-system';

const labels = {
  aboutLabel: 'О чём эфир',
  programLabel: 'Программа',
  programDownloadLabel: 'Скачать программу (PDF)',
  speakersLabel: 'Спикеры',
  sponsorEyebrow: 'При поддержке',
  sponsorNote:
    'Спонсор оплачивает эфир и не влияет на программу. Содержание определяют спикеры и школа.',
};

export const FullWithSponsorAndProgram = () => (
  <div className="w-full">
    <WebinarPageContent
      {...labels}
      description="Разбираем три реальных случая пластики ахиллова сухожилия — от выбора техники до реабилитационного протокола. Без лекционной воды: снимки, интраоперационные видео, осложнения и честный разбор ошибок."
      speakers={[
        { name: 'Анна Соколова', credentials: 'Травматолог-ортопед, к.м.н. · НМИЦ им. Пирогова' },
      ]}
      partners={[{ label: 'Acme Pharma' }]}
      programPdfUrl="#"
    />
  </div>
);

export const NoProgramNoSponsorTwoSpeakers = () => (
  <div className="w-full">
    <WebinarPageContent
      {...labels}
      description="Обсуждаем ведение пациентов с ревматоидным артритом в амбулаторной практике: когда начинать генно-инженерную терапию и как контролировать её безопасность."
      speakers={[
        { name: 'Ольга Литвинова', credentials: 'Ревматолог, д.м.н.' },
        { name: 'Сергей Ковалёв', credentials: 'Ревматолог, к.м.н.' },
      ]}
    />
  </div>
);
