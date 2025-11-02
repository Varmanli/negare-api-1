import { config } from 'dotenv';
import { resolve } from 'path';

const cwd = process.cwd();

config({ path: resolve(cwd, '.env.test') });
config({ path: resolve(cwd, '.env') });

process.env.AUTH_ACCESS_SECRET ??= 'dev_access_secret_for_tests';
process.env.AUTH_REFRESH_SECRET ??= 'dev_refresh_secret_for_tests';
process.env.AUTH_ACCESS_TTL ??= '900s';
process.env.AUTH_REFRESH_TTL ??= '30d';

process.env.ACCESS_JWT_SECRET ??=
  process.env.AUTH_ACCESS_SECRET ?? 'dev_access_secret_for_tests';
process.env.ACCESS_JWT_EXPIRES ??=
  process.env.AUTH_ACCESS_TTL ?? '900s';
process.env.REFRESH_JWT_SECRET ??=
  process.env.AUTH_REFRESH_SECRET ?? 'dev_refresh_secret_for_tests';
process.env.REFRESH_JWT_EXPIRES ??=
  process.env.AUTH_REFRESH_TTL ?? '30d';
process.env.SET_PWD_JWT_SECRET ??= 'test_set_password_secret';
process.env.SET_PWD_JWT_EXPIRES ??= '10m';
