import { EventFormatBlock } from '@ds/design-system';

export const OnlineWithDuringLine = () => (
  <div style={{ width: 640 }}>
    <EventFormatBlock
      kind="online"
      roomOpensLine="Комната эфира откроется за 10 минут до начала"
      duringLine="Во время эфира: вопрос лектору · опросы с живым графиком · отметки присутствия для НМО (90 минут и 2 отметки)"
    />
  </div>
);

export const OnlineRoomLineOnly = () => (
  <div style={{ width: 640 }}>
    <EventFormatBlock kind="online" roomOpensLine="Комната эфира откроется за 10 минут до начала" />
  </div>
);
