export interface CongressActor {
  id: string;
  email: string;
  zitadel_sub: string | null;
}

export function accumulateCongressActors(
  previous: readonly CongressActor[],
  observed: readonly CongressActor[],
): CongressActor[] {
  return [
    ...new Map(
      [...previous, ...observed].map((actor) => [actor.id, actor]),
    ).values(),
  ];
}
