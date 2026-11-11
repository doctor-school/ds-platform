import { EventFormatRoomPanel } from "@ds/design-system";

export const BeforeTheStart = () => (
  <div style={{ width: 640 }}>
    <EventFormatRoomPanel
      roomOpensLine="Комната эфира откроется за 10 минут до начала"
      duringLine="Во время эфира: вопрос лектору · опросы с живым графиком · отметки присутствия для НМО (90 минут и 2 отметки)"
    />
  </div>
);

export const DuringLineOnly = () => (
  <div style={{ width: 640 }}>
    <EventFormatRoomPanel duringLine="Во время эфира: вопрос лектору · опросы · отметки присутствия" />
  </div>
);
