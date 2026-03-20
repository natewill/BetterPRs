import { seedDefaultRepo } from "@/server/refresh";

async function main() {
  const repo = await seedDefaultRepo();
  console.log(`Seeded repo: ${repo.fullName} (id=${repo.id})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
