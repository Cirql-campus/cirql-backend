const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/cirql_dev').then(() => {
  return mongoose.connection.db.collection('users').updateOne(
    { email: 'abhishek.25014001@kiet.edu' },
    { $set: { role: 'admin' } }
  );
}).then((res) => {
  console.log('Upgraded to admin:', res.modifiedCount);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
