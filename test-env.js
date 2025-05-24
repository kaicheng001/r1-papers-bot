require('dotenv').config();
console.log('APP_ID:', process.env.APP_ID);
console.log('WEBHOOK_SECRET:', process.env.WEBHOOK_SECRET);
console.log('PRIVATE_KEY:', process.env.PRIVATE_KEY ? 'SET' : 'NOT SET');