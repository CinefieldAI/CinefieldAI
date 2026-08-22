-- Cinefield production security hardening — media/project tenant integrity.
--
-- media_assets is written through service_role paths, so RLS alone is not an
-- adequate integrity boundary. A caller must never be able to create an asset
-- owned by user A while attaching it to a project owned by user B.
--
-- This trigger enforces the invariant at the database boundary for EVERY
-- writer (present and future), including SECURITY DEFINER/service_role code.
-- project_id remains nullable for assets that are intentionally not attached
-- to a project.

CREATE OR REPLACE FUNCTION "public"."enforce_media_asset_project_owner"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.clerk_user_id IS NULL OR char_length(NEW.clerk_user_id) = 0 THEN
    RAISE EXCEPTION 'media_asset_owner_required' USING ERRCODE = '23514';
  END IF;

  PERFORM 1
    FROM projects
   WHERE id = NEW.project_id
     AND clerk_user_id = NEW.clerk_user_id;

  IF NOT FOUND THEN
    -- Deliberately does not reveal whether the project exists for another
    -- tenant. Application code may translate this to its generic asset-write
    -- failure/not-found response; the invariant is enforced here regardless.
    RAISE EXCEPTION 'media_asset_project_not_found' USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_media_asset_project_owner"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_media_asset_project_owner"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."enforce_media_asset_project_owner"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."enforce_media_asset_project_owner"() FROM "authenticated";

DROP TRIGGER IF EXISTS "media_assets_project_owner_guard" ON "public"."media_assets";
CREATE TRIGGER "media_assets_project_owner_guard"
BEFORE INSERT OR UPDATE OF "project_id", "clerk_user_id" ON "public"."media_assets"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_media_asset_project_owner"();

COMMENT ON FUNCTION "public"."enforce_media_asset_project_owner"() IS
  'Security invariant: media_assets.project_id may reference only a project whose clerk_user_id equals the asset owner, including service_role writes.';
