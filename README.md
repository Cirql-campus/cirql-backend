# Backend for cirql

## Admin Tools & CLI Scripts

### Promote a User to Admin
To promote a user to the `"admin"` role, run the following script with the target user's email address:
```bash
node scripts/promote-admin.js <email>
```
*Example:*
```bash
node scripts/promote-admin.js abhishek.25014001@kiet.edu
```

### Migrate Production Fields
To initialize production fields on listings, reports, and messages, run:
```bash
npm run migrate:production-fields
```

