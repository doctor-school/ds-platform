// Legal per the §4 graph: wave-1 auth-flow may import room + events-storefront.
import { joinRoom } from "@ds/room";
import { eventCard } from "@ds/events-storefront";
import { schema } from "@ds/schemas";

export const green = [joinRoom, eventCard, schema];
