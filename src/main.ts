import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3000; // Fallback if PORT not set
  await app.listen(port);
  console.log(`Server running on port ${port}`);
}
bootstrap();
