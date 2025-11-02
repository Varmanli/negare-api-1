import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from './core/core.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CatalogModule } from './catalog/catalog.module';
import { AppConfigModule, AllConfig } from './config/config.module';

@Module({
  imports: [
    AppConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<AllConfig>) => {
        const dbType = cfg.get<string>('DB_TYPE');
        if (dbType === 'sqlite') {
          const database = cfg.get<string>('DB_DATABASE') ?? ':memory:';
          return {
            type: 'sqlite',
            database,
            autoLoadEntities: true,
            synchronize: true,
            logging: false,
          };
        }

        const url = cfg.get<string>('DATABASE_URL');
        if (!url) {
          throw new Error(
            'DATABASE_URL must be provided unless DB_TYPE=sqlite is configured.',
          );
        }
        return {
          type: 'postgres',
          url,
          autoLoadEntities: true,
          synchronize: false,
          logging: ['error', 'warn'],
        };
      },
    }),
    NotificationsModule,
    HealthModule,
    CoreModule,
    CatalogModule,
  ],
})
export class AppModule {}
