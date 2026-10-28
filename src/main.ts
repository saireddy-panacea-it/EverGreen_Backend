import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const SLOW_REQUEST_MS = 1000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    credentials: true,
  });
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const elapsed = Date.now() - started;
      if (elapsed >= SLOW_REQUEST_MS) {
        console.warn(`slow request ${req.method} ${req.originalUrl?.split('?')[0]} ${res.statusCode} ${elapsed}ms`);
      }
    });
    next();
  });

  const port = process.env.PORT || 3000; // Fallback if PORT not set
  await app.listen(port, '0.0.0.0');
  console.log(`Server running on port ${port}`);
}
bootstrap();
