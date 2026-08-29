DO $$
DECLARE
  offenders jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'kind', kind,
    'id', id,
    'slug', slug,
    'length', char_length(slug)
  ) ORDER BY kind, id)
  INTO offenders
  FROM (
    SELECT 'direction' AS kind, id, slug FROM directions
    UNION ALL SELECT 'expert', id, slug FROM experts
    UNION ALL SELECT 'partner', id, slug FROM partners
    UNION ALL SELECT 'project', id, slug FROM projects
  ) retained
  WHERE char_length(slug) > 80;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'taxonomy slug max-length preflight failed'
      USING DETAIL = offenders::text,
            HINT = 'Resolve the listed retained rows by an owner-approved policy; this migration never truncates stable slugs.';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "directions" ADD CONSTRAINT "directions_slug_bounds" CHECK (char_length("directions"."slug") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "experts" ADD CONSTRAINT "experts_slug_bounds" CHECK (char_length("experts"."slug") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_slug_bounds" CHECK (char_length("partners"."slug") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_slug_bounds" CHECK (char_length("projects"."slug") BETWEEN 1 AND 80);
