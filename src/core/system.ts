import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArchGraph, SystemView, TechCategory, TechNode } from './types';

interface TechDef {
  id: string;
  name: string;
  category: TechCategory;
  /** npm / PyPI names; entries ending in '/' match a scope prefix. */
  packages: string[];
  /** docker image name fragments. */
  images?: string[];
  /** .env key prefixes. */
  env?: string[];
}

const CATALOG: TechDef[] = [
  // databases
  { id: 'postgres', name: 'PostgreSQL', category: 'database', packages: ['pg', 'postgres', 'pg-promise', 'psycopg2', 'psycopg', 'psycopg2-binary', 'asyncpg', '@neondatabase/serverless', '@vercel/postgres'], images: ['postgres', 'postgis', 'timescale'], env: ['POSTGRES', 'PG', 'DATABASE_URL'] },
  { id: 'mysql', name: 'MySQL', category: 'database', packages: ['mysql', 'mysql2', 'pymysql', 'MySQLdb', 'mysqlclient', 'aiomysql', '@planetscale/database'], images: ['mysql', 'mariadb'], env: ['MYSQL'] },
  { id: 'mongodb', name: 'MongoDB', category: 'database', packages: ['mongodb', 'mongoose', 'pymongo', 'motor', 'mongoengine', 'beanie'], images: ['mongo'], env: ['MONGO'] },
  { id: 'sqlite', name: 'SQLite', category: 'database', packages: ['sqlite3', 'better-sqlite3', 'sqlite', '@libsql/client'] },
  { id: 'prisma', name: 'Prisma ORM', category: 'database', packages: ['@prisma/client', 'prisma'] },
  { id: 'drizzle', name: 'Drizzle ORM', category: 'database', packages: ['drizzle-orm'] },
  { id: 'typeorm', name: 'TypeORM', category: 'database', packages: ['typeorm'] },
  { id: 'sequelize', name: 'Sequelize', category: 'database', packages: ['sequelize'] },
  { id: 'knex', name: 'Knex', category: 'database', packages: ['knex'] },
  { id: 'sqlalchemy', name: 'SQLAlchemy', category: 'database', packages: ['sqlalchemy', 'sqlmodel', 'flask_sqlalchemy'] },
  { id: 'supabase', name: 'Supabase', category: 'database', packages: ['@supabase/supabase-js', '@supabase/', 'supabase'], env: ['SUPABASE'] },
  { id: 'firebase', name: 'Firebase', category: 'database', packages: ['firebase', 'firebase-admin', 'firebase_admin', '@firebase/'], env: ['FIREBASE'] },
  { id: 'dynamodb', name: 'DynamoDB', category: 'database', packages: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb', 'dynamoose'] },
  // caches
  { id: 'redis', name: 'Redis', category: 'cache', packages: ['redis', 'ioredis', '@upstash/redis', '@redis/client', 'aioredis'], images: ['redis', 'valkey', 'keydb'], env: ['REDIS'] },
  { id: 'memcached', name: 'Memcached', category: 'cache', packages: ['memcached', 'memjs', 'pymemcache'], images: ['memcached'] },
  // queues
  { id: 'kafka', name: 'Kafka', category: 'queue', packages: ['kafkajs', 'kafka-node', 'confluent_kafka', 'kafka', 'aiokafka'], images: ['kafka', 'redpanda'], env: ['KAFKA'] },
  { id: 'rabbitmq', name: 'RabbitMQ', category: 'queue', packages: ['amqplib', 'amqp-connection-manager', 'pika', 'aio_pika', 'kombu'], images: ['rabbitmq'], env: ['RABBIT', 'AMQP'] },
  { id: 'bullmq', name: 'BullMQ', category: 'queue', packages: ['bullmq', 'bull', 'bee-queue'] },
  { id: 'celery', name: 'Celery', category: 'queue', packages: ['celery'] },
  { id: 'sqs', name: 'Amazon SQS', category: 'queue', packages: ['@aws-sdk/client-sqs', 'sqs-consumer'] },
  { id: 'nats', name: 'NATS', category: 'queue', packages: ['nats', 'nats-py'], images: ['nats'] },
  // storage
  { id: 's3', name: 'Amazon S3', category: 'storage', packages: ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner', 'minio'], images: ['minio'], env: ['S3_', 'AWS_S3'] },
  { id: 'cloudinary', name: 'Cloudinary', category: 'storage', packages: ['cloudinary'], env: ['CLOUDINARY'] },
  // cloud
  { id: 'aws', name: 'AWS', category: 'cloud', packages: ['aws-sdk', '@aws-sdk/', 'boto3', 'botocore', 'aws-cdk-lib', '@aws-cdk/'], images: ['localstack'], env: ['AWS_'] },
  { id: 'gcp', name: 'Google Cloud', category: 'cloud', packages: ['@google-cloud/', 'google.cloud', 'google-cloud'], env: ['GOOGLE_CLOUD', 'GCP_'] },
  { id: 'azure', name: 'Azure', category: 'cloud', packages: ['@azure/', 'azure'], env: ['AZURE'] },
  { id: 'vercel', name: 'Vercel', category: 'cloud', packages: ['@vercel/analytics', '@vercel/kv', '@vercel/blob', '@vercel/edge-config'] },
  // payments
  { id: 'stripe', name: 'Stripe', category: 'payment', packages: ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js'], env: ['STRIPE'] },
  { id: 'paypal', name: 'PayPal', category: 'payment', packages: ['@paypal/checkout-server-sdk', '@paypal/react-paypal-js', 'paypalrestsdk'], env: ['PAYPAL'] },
  { id: 'razorpay', name: 'Razorpay', category: 'payment', packages: ['razorpay'], env: ['RAZORPAY'] },
  // AI
  { id: 'openai', name: 'OpenAI', category: 'ai', packages: ['openai', '@ai-sdk/openai'], env: ['OPENAI'] },
  { id: 'anthropic', name: 'Anthropic Claude', category: 'ai', packages: ['@anthropic-ai/sdk', 'anthropic', '@ai-sdk/anthropic'], env: ['ANTHROPIC'] },
  { id: 'gemini', name: 'Google Gemini', category: 'ai', packages: ['@google/generative-ai', '@google/genai', 'google.generativeai', 'google.genai'], env: ['GEMINI', 'GOOGLE_API_KEY'] },
  { id: 'langchain', name: 'LangChain', category: 'ai', packages: ['langchain', '@langchain/', 'langchain_core', 'langchain_community', 'langgraph'] },
  { id: 'vercel-ai', name: 'Vercel AI SDK', category: 'ai', packages: ['ai'] },
  { id: 'huggingface', name: 'Hugging Face', category: 'ai', packages: ['transformers', '@huggingface/', 'huggingface_hub', 'datasets'], env: ['HF_', 'HUGGINGFACE'] },
  { id: 'pytorch', name: 'PyTorch', category: 'ai', packages: ['torch', 'torchvision'] },
  { id: 'tensorflow', name: 'TensorFlow', category: 'ai', packages: ['tensorflow', '@tensorflow/', 'keras'] },
  { id: 'pinecone', name: 'Pinecone', category: 'search', packages: ['@pinecone-database/pinecone', 'pinecone'], env: ['PINECONE'] },
  // auth
  { id: 'nextauth', name: 'Auth.js', category: 'auth', packages: ['next-auth', '@auth/'], env: ['NEXTAUTH', 'AUTH_SECRET'] },
  { id: 'clerk', name: 'Clerk', category: 'auth', packages: ['@clerk/'], env: ['CLERK'] },
  { id: 'auth0', name: 'Auth0', category: 'auth', packages: ['@auth0/', 'auth0'], env: ['AUTH0'] },
  { id: 'passport', name: 'Passport', category: 'auth', packages: ['passport', 'passport-jwt', 'passport-local'] },
  { id: 'jwt', name: 'JWT', category: 'auth', packages: ['jsonwebtoken', 'jose', 'jwt', 'pyjwt', 'python-jose', 'jwt-decode'], env: ['JWT'] },
  // messaging
  { id: 'twilio', name: 'Twilio', category: 'messaging', packages: ['twilio'], env: ['TWILIO'] },
  { id: 'sendgrid', name: 'SendGrid', category: 'messaging', packages: ['@sendgrid/mail', 'sendgrid'], env: ['SENDGRID'] },
  { id: 'resend', name: 'Resend', category: 'messaging', packages: ['resend'], env: ['RESEND'] },
  { id: 'nodemailer', name: 'SMTP (Nodemailer)', category: 'messaging', packages: ['nodemailer', 'smtplib', 'aiosmtplib'], env: ['SMTP'] },
  { id: 'slack', name: 'Slack', category: 'messaging', packages: ['@slack/web-api', '@slack/bolt', 'slack_sdk', 'slack_bolt'], env: ['SLACK'] },
  { id: 'socketio', name: 'Socket.IO', category: 'messaging', packages: ['socket.io', 'socket.io-client', 'socketio', 'python-socketio'] },
  // search
  { id: 'elasticsearch', name: 'Elasticsearch', category: 'search', packages: ['@elastic/elasticsearch', 'elasticsearch', 'elasticsearch_dsl'], images: ['elasticsearch', 'opensearch'], env: ['ELASTIC'] },
  { id: 'algolia', name: 'Algolia', category: 'search', packages: ['algoliasearch'], env: ['ALGOLIA'] },
  { id: 'meilisearch', name: 'Meilisearch', category: 'search', packages: ['meilisearch'], images: ['meilisearch'] },
  // observability
  { id: 'sentry', name: 'Sentry', category: 'observability', packages: ['@sentry/', 'sentry_sdk', 'raven'], env: ['SENTRY'] },
  { id: 'opentelemetry', name: 'OpenTelemetry', category: 'observability', packages: ['@opentelemetry/', 'opentelemetry'] },
  { id: 'datadog', name: 'Datadog', category: 'observability', packages: ['dd-trace', 'datadog', 'ddtrace'], env: ['DD_', 'DATADOG'] },
  { id: 'prometheus', name: 'Prometheus', category: 'observability', packages: ['prom-client', 'prometheus_client'], images: ['prometheus', 'grafana'] },
  { id: 'logging', name: 'Structured logging', category: 'observability', packages: ['winston', 'pino', 'bunyan', 'loguru', 'structlog'] },
  // http clients / external APIs
  { id: 'http', name: 'HTTP APIs', category: 'http', packages: ['axios', 'node-fetch', 'got', 'ky', 'undici', 'superagent', 'requests', 'httpx', 'urllib3', 'aiohttp'] },
  { id: 'graphql', name: 'GraphQL', category: 'http', packages: ['graphql', '@apollo/client', '@apollo/server', 'apollo-server', 'urql', 'graphql-request', 'strawberry', 'graphene', 'ariadne'] },
  { id: 'trpc', name: 'tRPC', category: 'http', packages: ['@trpc/'] },
  { id: 'grpc', name: 'gRPC', category: 'http', packages: ['@grpc/grpc-js', 'grpc', 'grpcio'] },
  // frameworks
  { id: 'react', name: 'React', category: 'framework', packages: ['react', 'react-dom'] },
  { id: 'nextjs', name: 'Next.js', category: 'framework', packages: ['next'] },
  { id: 'vue', name: 'Vue', category: 'framework', packages: ['vue', 'nuxt'] },
  { id: 'svelte', name: 'Svelte', category: 'framework', packages: ['svelte', '@sveltejs/kit'] },
  { id: 'angular', name: 'Angular', category: 'framework', packages: ['@angular/core'] },
  { id: 'solid', name: 'Solid', category: 'framework', packages: ['solid-js'] },
  { id: 'react-native', name: 'React Native', category: 'framework', packages: ['react-native', 'expo'] },
  { id: 'electron', name: 'Electron', category: 'framework', packages: ['electron'] },
  { id: 'vscode', name: 'VS Code API', category: 'framework', packages: ['vscode'] },
  { id: 'express', name: 'Express', category: 'framework', packages: ['express'] },
  { id: 'fastify', name: 'Fastify', category: 'framework', packages: ['fastify'] },
  { id: 'koa', name: 'Koa', category: 'framework', packages: ['koa'] },
  { id: 'nestjs', name: 'NestJS', category: 'framework', packages: ['@nestjs/core', '@nestjs/common'] },
  { id: 'hono', name: 'Hono', category: 'framework', packages: ['hono'] },
  { id: 'fastapi', name: 'FastAPI', category: 'framework', packages: ['fastapi'] },
  { id: 'flask', name: 'Flask', category: 'framework', packages: ['flask'] },
  { id: 'django', name: 'Django', category: 'framework', packages: ['django', 'rest_framework'] },
  { id: 'starlette', name: 'Starlette', category: 'framework', packages: ['starlette'] },
  { id: 'pydantic', name: 'Pydantic', category: 'framework', packages: ['pydantic'] },
  { id: 'tailwind', name: 'Tailwind CSS', category: 'framework', packages: ['tailwindcss', 'tailwind-merge'] },
  { id: 'streamlit', name: 'Streamlit', category: 'framework', packages: ['streamlit'] },
];

function matches(def: TechDef, pkg: string): boolean {
  const lower = pkg.toLowerCase();
  return def.packages.some((p) => (p.endsWith('/') ? lower.startsWith(p.toLowerCase()) : lower === p.toLowerCase()));
}

function readText(p: string): string | undefined {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}

/** Service names and images from docker-compose files (tiny indentation-based reader, no full YAML). */
export function parseCompose(text: string): { name: string; image?: string }[] {
  const out: { name: string; image?: string }[] = [];
  const lines = text.split(/\r?\n/);
  let inServices = false;
  let serviceIndent = -1;
  let current: { name: string; image?: string } | undefined;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0) {
      inServices = line === 'services:';
      serviceIndent = -1;
      current = undefined;
      continue;
    }
    if (!inServices) continue;
    if (serviceIndent < 0) serviceIndent = indent;
    if (indent === serviceIndent && /^[\w.-]+:\s*$/.test(line)) {
      current = { name: line.slice(0, -1).trim() };
      out.push(current);
    } else if (current && indent > serviceIndent) {
      const m = line.match(/^image:\s*["']?([^"'\s]+)/);
      if (m) current.image = m[1];
    }
  }
  return out;
}

/** Env var names (never values) from example env files. */
export function parseEnvKeys(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/^export\s+/, '').split('=')[0].trim())
    .filter((k) => /^[A-Z][A-Z0-9_]*$/.test(k));
}

export function detectSystem(root: string, graph: ArchGraph): SystemView {
  const found = new Map<string, TechNode>();
  const get = (def: TechDef): TechNode => {
    let t = found.get(def.id);
    if (!t) found.set(def.id, (t = { id: `tech:${def.id}`, name: def.name, category: def.category, sources: [], packages: [], usedBy: {} }));
    return t;
  };
  const addSource = (t: TechNode, s: TechNode['sources'][number]) => {
    if (!t.sources.includes(s)) t.sources.push(s);
  };

  for (const ext of graph.externals) {
    // sqlite3 / smtplib are Python stdlib, still worth showing.
    for (const def of CATALOG) {
      if (!matches(def, ext.name)) continue;
      const t = get(def);
      addSource(t, 'import');
      if (!t.packages.includes(ext.name)) t.packages.push(ext.name);
      for (const [c, n] of Object.entries(ext.usedBy)) t.usedBy[c] = (t.usedBy[c] ?? 0) + n;
      break;
    }
  }

  // Declared dependencies that are never imported directly (e.g. used through config).
  const pkgJson = readText(path.join(root, 'package.json'));
  if (pkgJson) {
    try {
      const j = JSON.parse(pkgJson);
      for (const name of Object.keys({ ...j.dependencies })) {
        const def = CATALOG.find((d) => matches(d, name));
        if (def && def.category !== 'framework') addSource(get(def), 'dependency');
      }
    } catch {
      // ignore malformed package.json
    }
  }
  for (const req of ['requirements.txt', 'pyproject.toml']) {
    const text = readText(path.join(root, req));
    if (!text) continue;
    const names = req === 'requirements.txt'
      ? text.split(/\r?\n/).map((l) => l.split(/[<>=!~\[;\s#]/)[0].trim()).filter(Boolean)
      : [...text.matchAll(/^\s*["']?([A-Za-z0-9_.-]+)\s*(?:[<>=!~\[]|["'],?\s*$)/gm)].map((m) => m[1]);
    for (const name of names) {
      const def = CATALOG.find((d) => matches(d, name) || matches(d, name.replace(/-/g, '_')));
      if (def && def.category !== 'framework') addSource(get(def), 'dependency');
    }
  }

  const composeServices: { name: string; image?: string }[] = [];
  for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const text = readText(path.join(root, f));
    if (!text) continue;
    for (const svc of parseCompose(text)) {
      composeServices.push(svc);
      const image = (svc.image ?? svc.name).toLowerCase().split('/').pop()!.split(':')[0];
      const def = CATALOG.find((d) => d.images?.some((i) => image.includes(i)));
      if (def) addSource(get(def), 'compose');
    }
  }

  for (const f of ['.env.example', '.env.sample', '.env.template', '.env.dist', 'example.env']) {
    const text = readText(path.join(root, f));
    if (!text) continue;
    for (const key of parseEnvKeys(text)) {
      const def = CATALOG.find((d) => d.env?.some((p) => key.startsWith(p)));
      if (def) addSource(get(def), 'env');
    }
  }

  // Generic cloud entry is redundant when a specific AWS service is present.
  const all = [...found.values()];
  const techs = all.filter((t) => t.category !== 'framework');
  const frameworks = all.filter((t) => t.category === 'framework').sort((a, b) => total(b) - total(a));
  return { techs: techs.sort((a, b) => a.category.localeCompare(b.category) || total(b) - total(a)), frameworks, composeServices };
}

function total(t: TechNode): number {
  return Object.values(t.usedBy).reduce((a, b) => a + b, 0);
}
