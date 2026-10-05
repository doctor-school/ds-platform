// Shared data + view-model builders for events-feed.dc.html and events-facets.dc.html.
(function () {
  var K = {};
  var MG = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  var MN = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  var MS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  var DS = ['вс','пн','вт','ср','чт','пт','сб'];
  var DF = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
  var WD = ['пн','вт','ср','чт','пт','сб','вс'];
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var dayNo = function (y, m, d) { return Math.floor(Date.UTC(y, m, d) / 864e5); };
  var TODAY = { y: 2026, m: 9, d: 2 };
  var TODAY_NO = dayNo(2026, 9, 2);
  function plural(n, f) { var a = n % 10, b = n % 100; return f[(a === 1 && b !== 11) ? 0 : (a >= 2 && a <= 4 && (b < 10 || b >= 20)) ? 1 : 2]; }
  function parseMsk(s) { var p = s.split(' '), d = p[0].split('-').map(Number), t = p[1].split(':').map(Number); return Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1]) - 3 * 36e5; }
  function at(utc, tz) { var x = new Date(utc + tz * 36e5); return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay(), time: pad(x.getUTCHours()) + ':' + pad(x.getUTCMinutes()) }; }
  var zl = function (tz) { return tz === 3 ? 'МСК' : 'GMT+' + tz; };
  var dkey = function (p) { return p.y + '-' + pad(p.m + 1) + '-' + pad(p.d); };
  function dayLabel(p) {
    var i = dayNo(p.y, p.m, p.d) - TODAY_NO;
    var base = p.d + ' ' + MG[p.m] + (p.y !== 2026 ? ' ' + p.y : '') + ', ' + DF[p.dow];
    return i === 0 ? 'Сегодня · ' + base : i === 1 ? 'Завтра · ' + base : base;
  }

  var S = {
    strakhov: { name: 'Михаил Страхов', org: 'ЦИТО им. Приорова' },
    ershov: { name: 'Дмитрий Ершов', org: 'ЦИТО им. Приорова' },
    sokolova: { name: 'Анна Соколова', org: 'ведущая клуба' },
    panin: { name: 'Игорь Панин', org: 'НМИЦ ТО им. Вредена' },
    lebedeva: { name: 'Ольга Лебедева', org: 'клиника спортивной медицины «Движение»' },
    karimov: { name: 'Ренат Каримов', org: 'НМИЦ реабилитации' },
    orlova: { name: 'Вера Орлова', org: 'НМИЦ радиологии' },
    vvedenskaya: { name: 'Мария Введенская', org: 'НИИ ревматологии им. Насоновой' },
    kim: { name: 'Ольга Ким', org: 'НМИЦ эндокринологии' },
    committee: { name: 'Программный комитет', org: '12 экспертов направления' },
    vorontsova: { name: 'Елена Воронцова', org: 'директор по партнёрствам' },
    belov: { name: 'Артём Белов', org: 'продюсер школ' },
    gromova: { name: 'Ирина Громова', org: 'руководитель программы конгресса' }
  };

  var EV = {
    doctor: [
      { id: 'd-l1', msk: '2026-10-02 19:00', end: '20:30', kind: 'Эфир', format: 'онлайн', project: 'Школа ортобиологии', title: 'Вопросы по PRP после артроскопии', speakers: [S.strakhov], live: true, room: 412, spec: 'ortho', registered: true },
      { id: 'd-l2', msk: '2026-10-02 18:30', end: '20:00', kind: 'Клинический разбор с пациентом', format: 'онлайн', project: 'Школа спортивной медицины', title: 'Боль в плече у пловца: три пациента', speakers: [S.lebedeva], live: true, room: 168, spec: 'sport', nmo: '1 ЗЕТ' },
      { id: 'd-l3', msk: '2026-10-02 19:00', end: '21:00', kind: 'Вебинар', format: 'онлайн', project: 'Школа реабилитации', title: 'Ударно-волновая терапия при эпикондилите', speakers: [S.karimov], live: true, room: 96, spec: 'rehab' },
      { id: 'd-1', msk: '2026-10-06 19:00', kind: 'Вебинар', format: 'онлайн', project: 'Школа ортобиологии', title: 'PRP при гонартрозе', speakers: [S.strakhov, S.ershov], nmo: '2 ЗЕТ', registered: true, spec: 'ortho' },
      { id: 'd-2', msk: '2026-10-06 22:30', kind: 'Эфир', format: 'онлайн', project: 'Школа лучевой диагностики', title: 'Ночной разбор МРТ коленного сустава', speakers: [S.orlova], spec: 'rad' },
      { id: 'd-3', msk: '2026-10-08 18:00', kind: 'Клинический разбор с пациентом', format: 'онлайн', project: 'Школа ортобиологии', title: 'Повторный разрыв передней крестообразной связки у профессионального футболиста: ревизионная пластика, выбор трансплантата и сроки возврата в спорт', speakers: [S.ershov], nmo: '1 ЗЕТ', pul: 50, spec: 'ortho' },
      { id: 'd-endo', msk: '2026-10-09 18:00', kind: 'Вебинар', format: 'онлайн', project: 'Школа эндокринологии', title: 'Гипотиреоз: клинические разборы', speakers: [S.kim], spec: 'endo' },
      { id: 'd-4', msk: '2026-10-10 12:00', kind: 'Мастер-класс', format: 'гибрид', project: 'Школа артроскопии', title: 'Артроскопия плечевого сустава', speakers: [S.panin], city: 'Новосибирск', cid: 'nsk', venueTz: 7, seats: 8, pul: 120, nmo: '4 ЗЕТ', registered: true, spec: 'ortho' },
      { id: 'd-5', msk: '2026-10-16 18:30', kind: 'Встреча клуба', format: 'офлайн', project: 'Doctor Club', title: 'Doctor Club Казань', speakers: [S.sokolova], city: 'Казань', cid: 'kzn', seats: 12, registered: true, spec: 'ortho' },
      { id: 'd-6', msk: '2026-10-22 19:00', kind: 'Вебинар', format: 'онлайн', project: 'Школа ревматологии', title: 'Остеоартрит кисти: что нового в рекомендациях', speakers: [S.vvedenskaya], nmo: '2 ЗЕТ', spec: 'rheum' },
      { id: 'd-7', msk: '2027-03-19 10:00', kind: 'Конгресс', format: 'офлайн', project: 'Школа ортобиологии', title: 'VIII Конгресс ОРТОБИОЛОГИЯ 2027', speakers: [S.committee], city: 'Москва', cid: 'msk', seats: 140, pul: 300, nmo: '12 ЗЕТ', spec: 'ortho' },
      { id: 'd-p1', msk: '2026-09-24 19:00', past: true, kind: 'Вебинар', format: 'онлайн', project: 'Школа ортобиологии', title: 'Гиалуроновая кислота при гонартрозе: что говорит доказательная база', speakers: [S.strakhov], nmo: '2 ЗЕТ', recording: 'Запись · 54 мин', rec: true, spec: 'ortho' },
      { id: 'd-p2', msk: '2026-09-18 18:30', past: true, kind: 'Встреча клуба', format: 'офлайн', project: 'Doctor Club', title: 'Doctor Club Москва', speakers: [S.sokolova], city: 'Москва', cid: 'msk', recording: 'Без записи', spec: 'ortho' },
      { id: 'd-p3', msk: '2026-09-10 19:00', past: true, kind: 'Клинический разбор с пациентом', format: 'онлайн', project: 'Школа ортобиологии', title: 'Осложнения после PRP: разбор трёх случаев', speakers: [S.ershov], recording: 'Запись · 47 мин', rec: true, spec: 'ortho' },
      { id: 'd-p4', msk: '2026-08-27 19:00', past: true, kind: 'Вебинар', format: 'онлайн', project: 'Школа артроскопии', title: 'Реабилитация после пластики ПКС', speakers: [S.panin, S.karimov], recording: 'Запись · 1 ч 12 мин', rec: true, pul: 30, spec: 'sport' },
      { id: 'd-n1', msk: '2026-11-05 19:00', kind: 'Вебинар', format: 'онлайн', project: 'Школа ортобиологии', title: 'PRP при тендинопатиях: кому и когда', speakers: [S.strakhov], nmo: '2 ЗЕТ', spec: 'ortho' },
      { id: 'd-n2', msk: '2026-11-12 18:00', kind: 'Клинический разбор с пациентом', format: 'онлайн', project: 'Школа спортивной медицины', title: 'Стрессовые переломы у бегунов', speakers: [S.lebedeva], nmo: '1 ЗЕТ', spec: 'sport' },
      { id: 'd-n3', msk: '2026-11-20 18:30', kind: 'Встреча клуба', format: 'офлайн', project: 'Doctor Club', title: 'Doctor Club Новосибирск', speakers: [S.sokolova], city: 'Новосибирск', cid: 'nsk', seats: 15, spec: 'ortho' },
      { id: 'd-n4', msk: '2026-11-26 19:00', kind: 'Вебинар', format: 'онлайн', project: 'Школа лучевой диагностики', title: 'МРТ плечевого сустава: типичные ошибки описания', speakers: [S.orlova], spec: 'rad' },
      { id: 'd-dc1', msk: '2026-12-03 19:00', kind: 'Эфир', format: 'онлайн', project: 'Школа реабилитации', title: 'Реабилитация после эндопротезирования колена', speakers: [S.karimov], spec: 'rehab' },
      { id: 'd-dc2', msk: '2026-12-10 12:00', kind: 'Мастер-класс', format: 'гибрид', project: 'Школа артроскопии', title: 'Шов мениска: техника all-inside', speakers: [S.panin], city: 'Екатеринбург', venueTz: 5, seats: 10, pul: 120, nmo: '4 ЗЕТ', spec: 'ortho' },
      { id: 'd-dc3', msk: '2026-12-17 19:00', kind: 'Вебинар', format: 'онлайн', project: 'Школа ревматологии', title: 'Подагра: что изменилось в лечении', speakers: [S.vvedenskaya], nmo: '2 ЗЕТ', spec: 'rheum' },
      { id: 'd-j1', msk: '2027-01-21 19:00', kind: 'Вебинар', format: 'онлайн', project: 'Школа ортобиологии', title: 'Год в ортобиологии: главные исследования 2026', speakers: [S.strakhov, S.ershov], nmo: '2 ЗЕТ', spec: 'ortho' },
      { id: 'd-j2', msk: '2027-01-28 18:30', kind: 'Клинический разбор с пациентом', format: 'онлайн', project: 'Школа спортивной медицины', title: 'Голеностоп у баскетболиста: три пациента', speakers: [S.lebedeva], spec: 'sport' },
      { id: 'd-f1', msk: '2027-02-11 19:00', kind: 'Вебинар', format: 'онлайн', project: 'Школа артроскопии', title: 'Нестабильность плеча: Латарже или Банкарт', speakers: [S.panin], nmo: '2 ЗЕТ', spec: 'ortho' },
      { id: 'd-f2', msk: '2027-02-18 18:30', kind: 'Встреча клуба', format: 'офлайн', project: 'Doctor Club', title: 'Doctor Club Москва', speakers: [S.sokolova], city: 'Москва', cid: 'msk', seats: 20, spec: 'ortho' },
      { id: 'd-p5', msk: '2026-08-20 19:00', past: true, kind: 'Вебинар', format: 'онлайн', project: 'Школа ортобиологии', title: 'Клеточные технологии в ортопедии: где граница доказательности', speakers: [S.strakhov], nmo: '2 ЗЕТ', recording: 'Запись · 58 мин', rec: true, spec: 'ortho' },
      { id: 'd-p6', msk: '2026-08-13 18:30', past: true, kind: 'Встреча клуба', format: 'офлайн', project: 'Doctor Club', title: 'Doctor Club Казань', speakers: [S.sokolova], city: 'Казань', cid: 'kzn', recording: 'Без записи', spec: 'ortho' },
      { id: 'd-p7', msk: '2026-07-23 19:00', past: true, kind: 'Эфир', format: 'онлайн', project: 'Школа лучевой диагностики', title: 'УЗИ ахиллова сухожилия', speakers: [S.orlova], recording: 'Запись · 41 мин', rec: true, spec: 'rad' },
      { id: 'd-p8', msk: '2026-07-09 19:00', past: true, kind: 'Вебинар', format: 'онлайн', project: 'Школа ревматологии', title: 'Псориатический артрит: ранняя диагностика', speakers: [S.vvedenskaya], recording: 'Запись · 1 ч 05 мин', rec: true, spec: 'rheum' }
    ],
    academy: [
      { id: 'a-l1', msk: '2026-10-02 18:00', end: '19:30', kind: 'Эфир', format: 'онлайн', project: 'Академия смыслов', pid: 'as', title: 'Как фарма выбирает образовательные проекты', speakers: [S.vorontsova], eids: ['vorontsova'], tid: 'partner', live: true, room: 86 },
      { id: 'a-1', msk: '2026-10-07 19:00', kind: 'Вебинар', format: 'онлайн', project: 'Академия смыслов', pid: 'as', title: 'Как собирается программа конгресса', speakers: [S.gromova], eids: ['gromova'], tid: 'program', registered: true },
      { id: 'a-2', msk: '2026-10-09 17:00', kind: 'Эфир', format: 'онлайн', project: 'Школа продюсеров', pid: 'sp', title: 'Бэкстейдж эфира: от сценария до трансляции', speakers: [S.belov], eids: ['belov'], tid: 'production' },
      { id: 'a-3', msk: '2026-10-14 18:00', kind: 'Вебинар', format: 'онлайн', project: 'Академия смыслов', pid: 'as', title: 'Метрики образовательного проекта: что видит партнёр', speakers: [S.vorontsova, S.belov], eids: ['vorontsova', 'belov'], tid: 'metrics', registered: true },
      { id: 'a-4', msk: '2026-10-21 19:00', kind: 'Эфир', format: 'онлайн', project: 'Школа продюсеров', pid: 'sp', title: 'Как устроена экспертная команда школы', speakers: [S.belov], eids: ['belov'], tid: 'production' },
      { id: 'a-p1', msk: '2026-09-23 19:00', past: true, kind: 'Эфир', format: 'онлайн', project: 'Академия смыслов', pid: 'as', title: 'Бюджет образовательного проекта: из чего он складывается', speakers: [S.vorontsova], eids: ['vorontsova'], tid: 'metrics', recording: 'Запись · 1 ч 02 мин', rec: true },
      { id: 'a-p2', msk: '2026-09-16 18:00', past: true, kind: 'Вебинар', format: 'онлайн', project: 'Школа продюсеров', pid: 'sp', title: 'Как партнёр читает отчёт школы', speakers: [S.belov], eids: ['belov'], tid: 'partner', recording: 'Запись · 48 мин', rec: true },
      { id: 'a-n1', msk: '2026-11-04 19:00', kind: 'Вебинар', format: 'онлайн', project: 'Академия смыслов', pid: 'as', title: 'Как оценить эффект образовательной программы', speakers: [S.vorontsova], eids: ['vorontsova'], tid: 'metrics' },
      { id: 'a-n2', msk: '2026-11-18 17:00', kind: 'Эфир', format: 'онлайн', project: 'Школа продюсеров', pid: 'sp', title: 'Сценарий эфира за один вечер', speakers: [S.belov], eids: ['belov'], tid: 'production' },
      { id: 'a-n3', msk: '2026-11-25 18:00', kind: 'Вебинар', format: 'онлайн', project: 'Академия смыслов', pid: 'as', title: 'Регуляторика фармкоммуникаций: что можно говорить врачу', speakers: [S.gromova], eids: ['gromova'], tid: 'regul' },
      { id: 'a-dc1', msk: '2026-12-09 19:00', kind: 'Эфир', format: 'онлайн', project: 'Академия смыслов', pid: 'as', title: 'Итоги года: что сработало у партнёров', speakers: [S.vorontsova], eids: ['vorontsova'], tid: 'partner' },
      { id: 'a-dc2', msk: '2026-12-16 18:00', kind: 'Вебинар', format: 'онлайн', project: 'Школа продюсеров', pid: 'sp', title: 'Запись и монтаж: как не потерять эфир', speakers: [S.belov], eids: ['belov'], tid: 'production' },
      { id: 'a-j1', msk: '2027-01-27 19:00', kind: 'Вебинар', format: 'онлайн', project: 'Академия смыслов', pid: 'as', title: 'Программа школ на 2027 год', speakers: [S.gromova], eids: ['gromova'], tid: 'program' },
      { id: 'a-f1', msk: '2027-02-10 18:00', kind: 'Эфир', format: 'онлайн', project: 'Школа продюсеров', pid: 'sp', title: 'Как выбрать спикера для школы', speakers: [S.belov, S.gromova], eids: ['belov', 'gromova'], tid: 'experts' },
      { id: 'a-p3', msk: '2026-08-26 19:00', past: true, kind: 'Вебинар', format: 'онлайн', project: 'Академия смыслов', pid: 'as', title: 'Эфир или конгресс: как партнёр выбирает формат', speakers: [S.vorontsova], eids: ['vorontsova'], tid: 'partner', recording: 'Запись · 52 мин', rec: true },
      { id: 'a-p4', msk: '2026-08-12 18:00', past: true, kind: 'Эфир', format: 'онлайн', project: 'Школа продюсеров', pid: 'sp', title: 'Студия на выезде: чек-лист', speakers: [S.belov], eids: ['belov'], tid: 'production', recording: 'Запись · 44 мин', rec: true },
      { id: 'a-p5', msk: '2026-07-15 19:00', past: true, kind: 'Вебинар', format: 'онлайн', project: 'Академия смыслов', pid: 'as', title: 'Программный комитет: как он работает', speakers: [S.gromova], eids: ['gromova'], tid: 'program', recording: 'Запись · 1 ч 10 мин', rec: true }
    ]
  };

  var KINDS = [['webinar', 'Вебинар'], ['efir', 'Эфир'], ['congress', 'Конгресс'], ['club', 'Встреча клуба'], ['master', 'Мастер-класс'], ['case', 'Клинический разбор с пациентом']];
  var kindId = function (l) { var k = KINDS.find(function (x) { return x[1] === l; }); return k ? k[0] : l; };
  var FMT = { 'онлайн': 'online', 'офлайн': 'offline', 'гибрид': 'hybrid' };
  var SPEC = [['ortho', 'Травматология и ортопедия'], ['sport', 'Спортивная медицина'], ['rehab', 'Реабилитация'], ['rad', 'Лучевая диагностика'], ['rheum', 'Ревматология'], ['endo', 'Эндокринология']];
  ['Авиационная и космическая медицина','Акушерство и гинекология','Аллергология и иммунология','Анестезиология-реаниматология','Бактериология','Вирусология','Водолазная медицина','Гастроэнтерология','Гематология','Генетика','Гериатрия','Гигиена детей и подростков','Гигиена питания','Гигиена труда','Гигиеническое воспитание','Дезинфектология','Дерматовенерология','Детская кардиология','Детская онкология','Детская урология-андрология','Детская хирургия','Детская эндокринология','Диетология','Инфекционные болезни','Кардиология','Клиническая лабораторная диагностика','Клиническая фармакология','Колопроктология','Коммунальная гигиена','Косметология','Лабораторная генетика','Лечебная физкультура','Мануальная терапия','Медико-социальная экспертиза','Медицинская биохимия','Медицинская кибернетика','Неврология','Нейрохирургия','Неонатология','Нефрология','Общая врачебная практика (семейная медицина)','Общая гигиена','Онкология','Организация здравоохранения и общественное здоровье','Ортодонтия','Остеопатия','Оториноларингология','Офтальмология','Паразитология','Патологическая анатомия','Педиатрия','Пластическая хирургия','Профпатология','Психиатрия','Психиатрия-наркология','Психотерапия','Пульмонология','Радиационная гигиена','Радиология','Радиотерапия','Рентгенология','Рентгенэндоваскулярные диагностика и лечение','Рефлексотерапия','Сексология','Сердечно-сосудистая хирургия','Скорая медицинская помощь','Стоматология детская','Стоматология общей практики','Стоматология ортопедическая','Стоматология терапевтическая','Стоматология хирургическая','Судебно-медицинская экспертиза','Судебно-психиатрическая экспертиза','Сурдология-оториноларингология','Терапия','Токсикология','Торакальная хирургия','Трансфузиология','Ультразвуковая диагностика','Урология','Физиотерапия','Фтизиатрия','Функциональная диагностика','Хирургия','Челюстно-лицевая хирургия','Эндоскопия','Эпидемиология'].forEach(function (l, i) { SPEC.push(['s' + i, l]); });
  SPEC.sort(function (a, b) { return a[1].localeCompare(b[1], 'ru'); });
  var CITY = [['msk', 'Москва'], ['kzn', 'Казань'], ['nsk', 'Новосибирск']];
  ['Санкт-Петербург','Екатеринбург','Нижний Новгород','Челябинск','Красноярск','Самара','Уфа','Ростов-на-Дону','Омск','Краснодар','Воронеж','Пермь','Волгоград','Саратов','Тюмень','Тольятти','Барнаул','Ижевск','Махачкала','Хабаровск','Ульяновск','Иркутск','Владивосток','Ярославль','Севастополь','Ставрополь','Томск','Кемерово','Набережные Челны','Оренбург','Новокузнецк','Балашиха','Рязань','Чебоксары','Калининград','Пенза','Липецк','Киров','Астрахань','Тула','Сочи','Курск','Улан-Удэ','Тверь','Магнитогорск','Сургут','Брянск','Якутск','Иваново','Владимир','Симферополь','Нижний Тагил','Калуга','Белгород','Чита','Грозный','Волжский','Смоленск','Подольск','Саранск','Вологда','Курган','Череповец','Архангельск','Орёл','Владикавказ','Нижневартовск','Йошкар-Ола','Стерлитамак','Мурманск','Кострома','Новороссийск','Тамбов','Химки','Мытищи','Нальчик','Таганрог','Нижнекамск','Благовещенск','Комсомольск-на-Амуре','Петрозаводск','Королёв','Шахты','Энгельс','Великий Новгород','Люберцы','Братск','Старый Оскол','Ангарск','Сыктывкар','Дзержинск','Псков','Орск','Красногорск','Армавир','Абакан','Балаково','Бийск','Южно-Сахалинск','Одинцово','Уссурийск','Прокопьевск','Рыбинск','Норильск','Волгодонск','Сызрань','Петропавловск-Камчатский','Каменск-Уральский','Новочеркасск','Альметьевск','Златоуст','Северодвинск','Хасавюрт','Керчь','Домодедово','Салават','Миасс','Копейск','Пятигорск','Электросталь','Майкоп','Находка','Березники','Коломна','Серпухов','Ковров','Нефтекамск','Кисловодск','Батайск','Рубцовск','Обнинск','Кызыл','Дербент','Нефтеюганск','Назрань','Каспийск','Долгопрудный','Новочебоксарск','Новомосковск','Ессентуки','Невинномысск','Октябрьский','Первоуральск','Раменское','Михайловск','Реутов','Черкесск','Жуковский','Димитровград','Пушкино','Артём','Камышин','Евпатория','Муром','Ханты-Мансийск','Новый Уренгой','Северск','Арзамас','Бердск','Элиста','Ногинск','Новошахтинск','Бердск'].filter(function (x, i, a) { return a.indexOf(x) === i; }).forEach(function (l, i) { CITY.push(['c' + i, l]); });
  CITY = CITY.slice(0, 3).concat(CITY.slice(3).sort(function (a, b) { return a[1].localeCompare(b[1], 'ru'); }));
  var MINE_ADJ = ['ortho', 'sport', 'rehab', 'rad', 'rheum'];
  var opt = function (a) { return a.map(function (x) { return { id: x[0], label: x[1] }; }); };
  var OPT = {
    doctor: {
      format: opt([['online', 'Онлайн'], ['offline', 'Офлайн'], ['hybrid', 'Гибрид']]),
      kind: opt(KINDS), specialty: opt(SPEC),
      city: opt(CITY)
    },
    academy: {
      format: opt([['as', 'Академия смыслов'], ['sp', 'Школа продюсеров'], ['p1', 'Школа ортобиологии'], ['p2', 'Школа артроскопии'], ['p3', 'Школа спортивной медицины'], ['p4', 'Школа реабилитации'], ['p5', 'Школа лучевой диагностики'], ['p6', 'Школа ревматологии'], ['p7', 'Школа эндокринологии'], ['p8', 'Doctor Club'], ['p9', 'Конгресс ОРТОБИОЛОГИЯ'], ['p10', 'Школа кардиологии'], ['p11', 'Школа неврологии'], ['p12', 'Школа гастроэнтерологии'], ['p13', 'Школа дерматологии'], ['p14', 'Школа педиатрии']]),
      kind: opt([['vorontsova', 'Елена Воронцова'], ['belov', 'Артём Белов'], ['gromova', 'Ирина Громова']].concat(
        ['Михаил Страхов', 'Дмитрий Ершов', 'Анна Соколова', 'Игорь Панин', 'Ольга Лебедева', 'Ренат Каримов', 'Вера Орлова', 'Мария Введенская', 'Ольга Ким',
         'Сергей Аксёнов', 'Наталья Белова', 'Константин Гусев', 'Юлия Демидова', 'Павел Жуков', 'Татьяна Зуева', 'Алексей Ильин', 'Екатерина Козлова', 'Андрей Лаптев',
         'Марина Мельникова', 'Николай Осипов', 'Светлана Пестова', 'Виктор Рябов', 'Ксения Савина', 'Григорий Тихонов', 'Дарья Устинова', 'Роман Фролов', 'Алина Хасанова', 'Евгений Чернов']
        .map(function (n, i) { return ['x' + i, n]; })).sort(function (a, b) { return a[1].split(' ')[1].localeCompare(b[1].split(' ')[1], 'ru'); })),
      city: opt([['partner', 'Партнёрства'], ['program', 'Программа школ'], ['production', 'Продакшн эфиров'], ['metrics', 'Метрики и отчётность'], ['regul', 'Регуляторика'], ['experts', 'Работа с экспертами'],
        ['t1', 'Аккредитация НМО'], ['t2', 'Аудитория и сегменты врачей'], ['t3', 'Бюджет проекта'], ['t4', 'Дизайн программы'], ['t5', 'Digital-продвижение школы'], ['t6', 'Запись и монтаж'],
        ['t7', 'Клинические разборы'], ['t8', 'Комплаенс фармкоммуникаций'], ['t9', 'Конгрессы и офлайн'], ['t10', 'Контент-стратегия'], ['t11', 'Медицинское письмо'], ['t12', 'Модерация дискуссии'],
        ['t13', 'Онлайн-трансляции'], ['t14', 'Опросы и обратная связь'], ['t15', 'Отчёт партнёру'], ['t16', 'Сценарий эфира'], ['t17', 'Спонсорские пакеты'], ['t18', 'Этика взаимодействия с врачами'],
        ['t19', 'Юридические вопросы'], ['t20', 'Вовлечённость слушателей']])
    }
  };
  // ---------- generated volume: 30+ events per month per host ----------
  (function () {
    var seed = 20261002, rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    var pickR = function (a) { return a[Math.floor(rnd() * a.length)]; };
    var TOP = {
      ortho: ['PRP при гонартрозе', 'Эндопротезирование тазобедренного сустава', 'Остеотомия большеберцовой кости', 'Разрыв вращательной манжеты плеча', 'Гиалуроновая кислота при артрозе', 'Перипротезная инфекция', 'Hallux valgus: выбор операции', 'Переломы на фоне остеопороза', 'Ревизионное эндопротезирование', 'Пластика ПКС', 'Повреждения мениска', 'Синдром карпального канала'],
      sport: ['Стрессовые переломы у бегунов', 'Тендинопатия ахиллова сухожилия', 'Возврат в спорт после травмы колена', 'Плечо пловца', 'Мышечные травмы бедра', 'Нестабильность голеностопа', 'Сотрясение мозга в спорте'],
      rehab: ['Реабилитация после эндопротезирования', 'Ударно-волновая терапия', 'Кинезиотерапия при болях в спине', 'Ранняя мобилизация после операций', 'Реабилитация после инсульта', 'Тренировка баланса у пожилых'],
      rad: ['МРТ коленного сустава', 'УЗИ плечевого сустава', 'КТ при травме таза', 'МРТ позвоночника: протокол описания', 'Лучевая диагностика остеоартрита'],
      rheum: ['Ревматоидный артрит: ранняя терапия', 'Подагра: целевой уровень урата', 'Псориатический артрит', 'Анкилозирующий спондилит', 'Остеоартрит кисти'],
      endo: ['Гипотиреоз', 'Сахарный диабет 2 типа: новые препараты', 'Остеопороз: антирезорбтивная терапия', 'Ожирение: фармакотерапия']
    };
    var SUF = [': разбор случаев', ': что нового', ': вопросы и ответы', ': ошибки и осложнения', ': практический протокол', ': дискуссия экспертов', ''];
    var PROJ = { ortho: ['Школа ортобиологии', 'Школа артроскопии'], sport: ['Школа спортивной медицины'], rehab: ['Школа реабилитации'], rad: ['Школа лучевой диагностики'], rheum: ['Школа ревматологии'], endo: ['Школа эндокринологии'] };
    var SPK = { ortho: [S.strakhov, S.ershov, S.panin], sport: [S.lebedeva], rehab: [S.karimov], rad: [S.orlova], rheum: [S.vvedenskaya], endo: [S.kim] };
    var SPW = ['ortho', 'ortho', 'ortho', 'sport', 'sport', 'rehab', 'rad', 'rheum', 'endo'];
    var KW = ['Вебинар', 'Вебинар', 'Вебинар', 'Эфир', 'Эфир', 'Клинический разбор с пациентом', 'Мастер-класс', 'Встреча клуба', 'Конгресс'];
    var OFF = [['Москва', 'msk', 3], ['Казань', 'kzn', 3], ['Новосибирск', 'nsk', 7]];
    var cityRow = function (l) { var c = CITY.find(function (x) { return x[1] === l; }); return c ? c[0] : l; };
    OFF.push(['Екатеринбург', cityRow('Екатеринбург'), 5], ['Санкт-Петербург', cityRow('Санкт-Петербург'), 3], ['Краснодар', cityRow('Краснодар'), 3]);
    var HOURS = [10, 11, 12, 14, 15, 16, 17, 18, 18, 19, 19, 19, 20, 21];
    var months = [[2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10], [2026, 11], [2027, 0], [2027, 1]];
    var AEX = OPT.academy.kind, ATH = OPT.academy.city, APR = OPT.academy.format;
    var ATOP = ['Как партнёр выбирает формат', 'Метрики вовлечённости', 'Бюджет школы', 'Сценарий эфира', 'Работа с модератором', 'Отчёт партнёру', 'Программа конгресса', 'Комплаенс в коммуникациях', 'Продвижение школы', 'Запись и монтаж', 'Экспертный совет', 'Опрос аудитории', 'Аккредитация НМО', 'Офлайн-событие под ключ'];
    var n = 0;
    months.forEach(function (ym) {
      var dim = new Date(Date.UTC(ym[0], ym[1] + 1, 0)).getUTCDate();
      ['doctor', 'academy'].forEach(function (host) {
        var cnt = 34 + Math.floor(rnd() * 12);
        for (var i = 0; i < cnt; i++) {
          var d = 1 + Math.floor(rnd() * dim);
          var dow = new Date(Date.UTC(ym[0], ym[1], d)).getUTCDay();
          if (dow === 0 && rnd() < .7) d = Math.min(dim, d + 1);
          if (ym[0] === 2026 && ym[1] === 9 && d === 2) d = 3;
          var hr = pickR(HOURS), mi = rnd() < .3 ? 30 : 0;
          var msk = ym[0] + '-' + pad(ym[1] + 1) + '-' + pad(d) + ' ' + pad(hr) + ':' + pad(mi);
          var past = dayNo(ym[0], ym[1], d) < TODAY_NO, e;
          if (host === 'doctor') {
            var sp = pickR(SPW), kind = pickR(KW), fmt = kind === 'Встреча клуба' || kind === 'Конгресс' ? 'офлайн' : kind === 'Мастер-класс' ? (rnd() < .6 ? 'гибрид' : 'офлайн') : 'онлайн';
            var c = fmt !== 'онлайн' ? pickR(fmt === 'гибрид' ? OFF.filter(function (x) { return x[2] !== 3; }) : OFF) : null;
            e = { id: 'g' + (n++), msk: msk, kind: kind, format: fmt, project: kind === 'Встреча клуба' ? 'Doctor Club' : pickR(PROJ[sp]), spec: sp,
              title: kind === 'Встреча клуба' ? 'Doctor Club ' + c[0] : kind === 'Конгресс' ? 'Региональная конференция: ' + pickR(TOP[sp]).toLowerCase() : pickR(TOP[sp]) + pickR(SUF),
              speakers: kind === 'Встреча клуба' ? [S.sokolova] : [pickR(SPK[sp])] };
            if (c) { e.city = c[0]; e.cid = c[1]; if (fmt === 'гибрид') e.venueTz = c[2]; if (!past) e.seats = 2 + Math.floor(rnd() * 60); }
            if (rnd() < .45) e.nmo = pickR(['1 ЗЕТ', '2 ЗЕТ', '2 ЗЕТ', '4 ЗЕТ']);
            if (fmt !== 'онлайн' && rnd() < .6) e.pul = pickR([50, 120, 200, 300]); else if (rnd() < .12) e.pul = pickR([30, 50]);
          } else {
            var ex = [pickR(AEX)]; if (rnd() < .25) ex.push(pickR(AEX));
            var pr = rnd() < .55 ? pickR(APR.slice(0, 2)) : pickR(APR);
            e = { id: 'g' + (n++), msk: msk, kind: rnd() < .55 ? 'Эфир' : 'Вебинар', format: 'онлайн', project: pr.label, pid: pr.id, title: pickR(ATOP) + pickR(SUF),
              speakers: ex.map(function (x) { return { name: x.label, org: 'эксперт Академии' }; }), eids: ex.map(function (x) { return x.id; }), tid: pickR(ATH).id };
          }
          if (past) { e.past = true; if (e.format === 'офлайн') e.recording = 'Без записи'; else { e.rec = true; e.recording = 'Запись · ' + (35 + Math.floor(rnd() * 50)) + ' мин'; } }
          else if (rnd() < .05) e.registered = true;
          EV[host].push(e);
        }
      });
    });
  })();

  var nameOf = function (list, id) { var o = list.find(function (x) { return x.id === id; }); return o ? o.label : id; };

  K.defaultApplied = function () { return { format: [], kind: [], specialtyScope: 'mine-and-adjacent', city: [], nmoOnly: false, freeByPul: false, query: '' }; };
  K.appliedCount = function (a) {
    return a.format.length + a.kind.length + a.city.length + (Array.isArray(a.specialtyScope) ? a.specialtyScope.length : a.specialtyScope === 'all' ? 1 : 0) + (a.nmoOnly ? 1 : 0) + (a.query ? 1 : 0);
  };
  function match(e, a, host) {
    if (host === 'doctor') {
      if (a.format.length && a.format.indexOf(FMT[e.format]) < 0) return false;
      if (a.kind.length && a.kind.indexOf(kindId(e.kind)) < 0) return false;
      var sc = a.specialtyScope;
      if (sc === 'mine-and-adjacent' && MINE_ADJ.indexOf(e.spec) < 0) return false;
      if (Array.isArray(sc) && !sc.some(function (r) { return r.id === e.spec; })) return false;
      if (a.city.length && (e.format !== 'офлайн' || a.city.indexOf(e.cid) < 0)) return false;
      if (a.nmoOnly && !e.nmo) return false;
    } else {
      if (a.format.length && a.format.indexOf(e.pid) < 0) return false;
      if (a.kind.length && !e.eids.some(function (x) { return a.kind.indexOf(x) >= 0; })) return false;
      if (a.city.length && a.city.indexOf(e.tid) < 0) return false;
    }
    if (a.query && e.title.toLowerCase().indexOf(a.query.toLowerCase()) < 0) return false;
    return true;
  }
  function facetChips(a, host) {
    var o = OPT[host], r = [], w = function (patch) { return Object.assign({}, a, patch); };
    var L = host === 'doctor' ? { format: 'Формат', kind: 'Вид', city: 'Город' } : { format: 'Проект', kind: 'Эксперт', city: 'Тема' };
    if (host === 'academy') a.city.forEach(function (id) { r.push({ label: L.city + ': ' + nameOf(o.city, id), without: w({ city: a.city.filter(function (x) { return x !== id; }) }), widen: 'Показать все темы' }); });
    if (Array.isArray(a.specialtyScope)) a.specialtyScope.forEach(function (ref) { r.push({ label: 'Специальность: ' + ref.label, without: w({ specialtyScope: 'mine-and-adjacent' }), widen: 'Показать смежные специальности', spec: true }); });
    a.format.forEach(function (id) { r.push({ label: L.format + ': ' + nameOf(o.format, id), without: w({ format: a.format.filter(function (x) { return x !== id; }) }) }); });
    a.kind.forEach(function (id) { r.push({ label: L.kind + ': ' + nameOf(o.kind, id), without: w({ kind: a.kind.filter(function (x) { return x !== id; }) }) }); });
    if (host === 'doctor') a.city.forEach(function (id) { r.push({ label: L.city + ': ' + nameOf(o.city, id), without: w({ city: a.city.filter(function (x) { return x !== id; }) }) }); });
    if (a.nmoOnly) r.push({ label: 'Только с НМО', without: w({ nmoOnly: false }) });
    if (a.query) r.push({ label: 'Поиск: «' + a.query + '»', without: w({ query: '' }) });
    return r;
  }
  var noun = function (host, n) { return host === 'doctor' ? plural(n, ['событие', 'события', 'событий']) : plural(n, ['эфир', 'эфира', 'эфиров']); };

  function card(e, o) {
    var utc = parseMsk(e.msk), z = e.format === 'офлайн' ? 3 : o.tz, p = at(utc, z);
    var c = { variant: e.past ? 'past' : 'upcoming', href: e.past ? 'event-page-recording.dc.html' : 'event-page.dc.html', time: p.time, tzLabel: zl(z),
      dateLabel: p.d + ' ' + MG[p.m] + (p.y !== 2026 ? ' ' + p.y : '') + ' · ' + DS[p.dow], school: e.project, title: e.title, speakers: e.speakers || [], kindLabel: e.kind, formatLabel: e.format };
    if (e.nmo) c.nmoLabel = 'НМО · ' + e.nmo;
    if (e.pul) { c.pulCost = e.pul; c.pulCostLabel = e.pul + ' Pul'; }
    if (e.city) c.city = e.city;
    if (!e.past && typeof e.seats === 'number') { c.seatsLeft = e.seats; c.seatsLeftLabel = 'мест осталось'; c.soldOutLabel = 'мест не осталось'; }
    if (e.format === 'гибрид' && e.venueTz) { c.venueLabel = 'На площадке'; c.venueTimeLabel = at(utc, e.venueTz).time + ' ' + zl(e.venueTz); }
    if (e.past) { c.recordingLabel = e.recording; if (e.rec) { c.ctaHref = 'event-page-recording.dc.html'; c.ctaLabel = 'Смотреть запись'; } }
    if (e.live && !e.past) { var reg = o.signedIn && e.registered; c.live = true; c.liveLabel = 'Идёт сейчас'; c.ctaHref = reg ? 'room.dc.html' : 'event-page.dc.html'; c.ctaLabel = reg ? 'Войти в комнату эфира' : 'Открыть страницу события'; }
    if (o.signedIn && e.registered && !e.past) { c.registered = true; c.registeredLabel = 'Вы записаны'; }
    return { e: e, c: c, p: p, utc: utc };
  }
  function listFor(o) {
    var past = o.tense === 'past';
    var xs = EV[o.host].filter(function (e) { return !!e.past === past && match(e, o.applied, o.host); }).map(function (e) { return card(e, o); });
    xs.sort(function (a, b) { return past ? b.utc - a.utc : a.utc - b.utc; });
    return xs;
  }

  K.feed = function (o) {
    var all = EV[o.host], past = o.tense === 'past';
    var xs = listFor(o);
    var items = xs.map(function (x) {
      return Object.assign({ id: x.e.id, groupKey: past ? x.p.y + '-' + pad(x.p.m + 1) : dkey(x.p), groupLabel: past ? MN[x.p.m] + ' ' + x.p.y : dayLabel(x.p) }, x.c);
    });
    var live = all.filter(function (e) { return e.live && !e.past; }).map(function (e) {
      var utc = parseMsk(e.msk), end = parseMsk(e.msk.slice(0, 10) + ' ' + e.end), reg = o.signedIn && e.registered;
      return { utc: utc, props: { liveLabel: 'Идёт сейчас', title: e.title, titleHref: 'event-page.dc.html', meta: e.room + ' в комнате · ' + e.project + ' · до ' + at(end, o.tz).time + ' ' + zl(o.tz), actionLabel: reg ? 'Войти в комнату эфира' : 'Открыть страницу события', actionHref: reg ? 'room.dc.html' : 'event-page.dc.html' } };
    }).sort(function (a, b) { return a.utc - b.utc; });
    var my = !o.signedIn ? [] : all.filter(function (e) { return e.registered && !e.past && !e.live; }).map(function (e) { return card(e, o); })
      .sort(function (a, b) { return a.utc - b.utc; }).slice(0, 3)
      .map(function (x) { return { href: 'event-page.dc.html', time: x.c.time + ' ' + x.c.tzLabel, school: x.p.d + ' ' + MG[x.p.m] + ', ' + DS[x.p.dow] + ' · ' + x.c.school, title: x.c.title }; });
    var up = all.filter(function (e) { return !e.past; });
    var schools = {}; up.forEach(function (e) { schools[e.project] = 1; });
    var ns = Object.keys(schools).length;
    return { xs: xs, items: items, live: live, my: my, count: xs.length,
      headCount: up.length + ' ' + plural(up.length, ['эфир', 'эфира', 'эфиров']) + ' · ' + ns + ' ' + plural(ns, ['школа', 'школы', 'школ']) };
  };

  K.empty = function (o) {
    var past = o.tense === 'past', chips = facetChips(o.applied, o.host), hit = null, n = 0;
    for (var i = 0; i < chips.length; i++) {
      var cnt = EV[o.host].filter(function (e) { return !!e.past === past && match(e, chips[i].without, o.host); }).length;
      if (cnt > 0) { hit = chips[i]; n = cnt; break; }
    }
    var what = o.host === 'doctor' ? 'событий' : 'эфиров';
    if (!hit) return { title: 'По выбранным фильтрам ' + what + ' нет', description: 'Сбросьте фильтры, чтобы увидеть всю ленту.', widen: null };
    return { title: 'Нет ' + what + ' по фильтру «' + hit.label + '»', description: (hit.spec ? 'В вашей и смежных специальностях найдётся ' : 'Без этого фильтра найдётся ') + n + ' ' + noun(o.host, n) + '.',
      widen: { label: hit.widen || 'Убрать фильтр «' + hit.label + '»', applied: hit.without } };
  };

  K.monthOf = function (tense) { return tense === 'past' ? { y: 2026, m: 8 } : { y: 2026, m: 9 }; };
  K.monthLabel = function (ym) { return MN[ym.m] + ' ' + ym.y; };
  K.weekdays = WD;
  function byDay(xs, y, m) { var r = {}; xs.forEach(function (x) { if (x.p.y === y && x.p.m === m) (r[x.p.d] = r[x.p.d] || []).push(x); }); Object.keys(r).forEach(function (k) { r[k].sort(function (a, b) { return (b.c.live ? 1 : 0) - (a.c.live ? 1 : 0) || a.utc - b.utc; }); }); return r; }
  function eachWeek(y, m, fn) {
    var first = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7, dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), weeks = [], i = 1 - first;
    while (i <= dim) { var w = []; for (var k = 0; k < 7; k++, i++) { var dt = new Date(Date.UTC(y, m, i)); w.push(fn(dt.getUTCDate(), dt.getUTCMonth() === m, k, dt.getUTCMonth(), i)); } weeks.push(w); }
    return weeks;
  }
  var isToday = function (y, m, d, inM) { return inM && y === TODAY.y && m === TODAY.m && d === TODAY.d; };
  K.dotWeeks = function (ym, xs) {
    var bd = byDay(xs, ym.y, ym.m);
    return eachWeek(ym.y, ym.m, function (d, inM, k, mm) {
      var evs = inM ? (bd[d] || []) : [];
      return { day: d, inMonth: inM, today: isToday(ym.y, ym.m, d, inM), dots: evs.slice(0, 3).map(function (x) { return x.c.live ? 'live' : x.e.past ? 'past' : 'planned'; }),
        ariaLabel: d + ' ' + MG[mm] + (evs.length ? ', ' + evs.length + ' ' + plural(evs.length, ['событие', 'события', 'событий']) : '') };
    });
  };
  K.gridWeeks = function (ym, xs) {
    var bd = byDay(xs, ym.y, ym.m);
    return eachWeek(ym.y, ym.m, function (d, inM, k, mm, i) {
      var evs = inM ? (bd[d] || []) : [], t = isToday(ym.y, ym.m, d, inM);
      return { dateLabel: t ? d + ' · сегодня' : String(d), muted: !inM || k >= 5, mutedDate: !inM || dayNo(ym.y, ym.m, i) < TODAY_NO, today: t,
        pills: evs.slice(0, 3).map(function (x) { return { href: x.c.href, time: x.c.time + ' ' + x.c.tzLabel, title: x.c.title, live: !!x.c.live, past: !!x.e.past }; }),
        more: evs.length > 3 ? { href: '#feed-day-' + ym.y + '-' + pad(ym.m + 1) + '-' + pad(d), label: '+' + (evs.length - 3) + ' ещё' } : undefined };
    });
  };
  K.agenda = function (ym, d, xs) {
    var bd = byDay(xs, ym.y, ym.m), dow = new Date(Date.UTC(ym.y, ym.m, d)).getUTCDay();
    return { title: d + ' ' + MG[ym.m] + ', ' + DF[dow] + (isToday(ym.y, ym.m, d, true) ? ' · сегодня' : ''), emptyText: 'В этот день событий нет',
      rows: (bd[d] || []).map(function (x) { return { href: x.c.href, time: x.c.time + ' ' + x.c.tzLabel, school: x.c.school, title: x.c.title, live: !!x.c.live, liveLabel: 'В эфире' }; }) };
  };
  // ---------- state ----------
  K.initState = function (P) {
    var a = K.defaultApplied();
    if (P.state === 'empty') Object.assign(a, P.host === 'doctor' ? { specialtyScope: [{ id: 'sport', label: 'Спортивная медицина' }], kind: ['club'] } : { format: ['as'], city: ['t19'] });
    return { applied: a, page: 1, cleared: {} };
  };
  K.showN = function (n, host) { return 'Показать ' + n + ' ' + noun(host, n); };
  K.filterBtn = function (a) { var n = K.appliedCount(a); return n ? 'Фильтры (' + n + ')' : 'Фильтры'; };
  K.todayKey = '2026-10-02';
  K.dkey = function (ym, d) { return ym.y + '-' + pad(ym.m + 1) + '-' + pad(d); };

  K.options = function (host) { return OPT[host]; };
  K.allXs = function (o) { return listFor(Object.assign({}, o, { tense: 'upcoming' })).concat(listFor(Object.assign({}, o, { tense: 'past' }))); };
  K.shiftMonth = function (ym, n) { var t = ym.y * 12 + ym.m + n; return { y: Math.floor(t / 12), m: t % 12 }; };
  K.today = { y: TODAY.y, m: TODAY.m, d: TODAY.d };
  K.isPastDay = function (y, m, d) { return dayNo(y, m, d) < TODAY_NO; };
  K.pickerFor = function (host, ym) {
    var ys = []; for (var yy0 = 2020; yy0 <= 2032; yy0++) ys.push(yy0);
    var p = { triggerLabel: K.monthLabel(ym), pickerLabel: 'Выбрать месяц', initialYear: String(ym.y), prevYearLabel: 'Предыдущий год', nextYearLabel: 'Следующий год', prevYearHref: '#', nextYearHref: '#' };
    p.years = ys.map(function (yy) {
      return { year: String(yy), months: MS.map(function (lab, mi) {
        var n = EV[host].filter(function (e) { var q = at(parseMsk(e.msk), 3); return q.y === yy && q.m === mi; }).length;
        var pastM = yy * 12 + mi < TODAY.y * 12 + TODAY.m;
        return { label: lab, note: n ? n + ' ' + plural(n, ['событие', 'события', 'событий']) : pastM ? 'архив' : 'нет событий', href: '#month-' + yy + '-' + pad(mi + 1), current: yy === ym.y && mi === ym.m, muted: !n };
      }) };
    });
    return p;
  };
  K.monthHref = function (ym) { return '#month-' + ym.y + '-' + pad(ym.m + 1); };
  window.EFK = K;
})();
