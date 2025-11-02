import 'reflect-metadata';
import { DataSource } from 'typeorm';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not defined');

export default new DataSource({
  type: 'postgres',
  url,
  synchronize: false,
  logging: ['error', 'warn'],

  entities: [__dirname + '/**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
});
