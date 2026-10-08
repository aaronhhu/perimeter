function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function port(): number {
  const value = Number(process.env.PORT || 3000);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }
  return value;
}

export const config = {
  port: port(),
  databaseUrl: required("DATABASE_URL"),
};
