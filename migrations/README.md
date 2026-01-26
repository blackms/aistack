# Database Migrations

This directory contains SQL migration scripts for the AgentStack database.

## Migration Files

Migrations are named with a numeric prefix to ensure proper ordering:
- `001_add_memory_enhancements.sql` - Adds tagging, relationships, and versioning

## Running Migrations

Migrations are automatically applied when the application starts. The SQLite store's `initSchema()` method runs all CREATE TABLE IF NOT EXISTS statements.

### Manual Migration

To manually apply a migration:

```bash
sqlite3 data/aistack.db < migrations/001_add_memory_enhancements.sql
```

### Rollback

Each migration file includes a DOWN section with DROP statements. To rollback:

```bash
# Extract the DOWN section and run it
sed -n '/-- ==================== DOWN ====================/,$p' migrations/001_add_memory_enhancements.sql | \
  grep -v "^--" | \
  sqlite3 data/aistack.db
```

## Creating New Migrations

1. Create a new file with the next sequential number: `002_your_migration_name.sql`
2. Include both UP and DOWN sections
3. Use `CREATE TABLE IF NOT EXISTS` for safety
4. Add appropriate indexes
5. Document the migration purpose in comments

## Migration Best Practices

- Always test migrations on a backup database first
- Use transactions for multi-step migrations
- Include rollback (DOWN) instructions
- Document breaking changes
- Add indexes for performance-critical queries
- Use foreign keys with ON DELETE CASCADE for data integrity

## Schema Versioning

The application uses SQLite's schema version pragma to track migrations:

```sql
PRAGMA user_version;  -- Check current version
PRAGMA user_version = 1;  -- Set version after migration
```

Future enhancement: Implement automatic migration tracking and version management.
