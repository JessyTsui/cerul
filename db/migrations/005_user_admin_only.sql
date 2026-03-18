BEGIN;

UPDATE user_profiles
SET console_role = 'admin'
WHERE console_role = 'operator';

ALTER TABLE user_profiles
    DROP CONSTRAINT IF EXISTS user_profiles_console_role_check;

ALTER TABLE user_profiles
    ADD CONSTRAINT user_profiles_console_role_check
    CHECK (console_role IN ('user', 'admin'));

COMMIT;
