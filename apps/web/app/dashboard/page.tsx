import { prisma } from '@cursor-usage/db';

export default async function DashboardPage() {
  let dbConnected = false;
  
  try {
    // Test DB connection by querying a simple table
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch (error) {
    console.error('Database connection failed:', error);
  }

  return (
    <main className="p-4">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <div className="p-4 border rounded">
        <p>DB connected: <span data-testid="db-status">{dbConnected ? 'yes' : 'no'}</span></p>
      </div>
    </main>
  );
}
