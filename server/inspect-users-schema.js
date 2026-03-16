import db from './database.js';

function inspectUsersSchema() {
  const rows = db.prepare('PRAGMA table_info(users);').all();
  console.log('users table schema:');
  for (const row of rows) {
    console.log(
      `${row.cid}: ${row.name} | type=${row.type} | notnull=${row.notnull} | dflt_value=${row.dflt_value} | pk=${row.pk}`
    );
  }
}

inspectUsersSchema();

