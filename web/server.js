const express = require('express');
const basicAuth = require('express-basic-auth');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(basicAuth({
  users: { [process.env.DASHBOARD_USER]: process.env.DASHBOARD_PASS },
  challenge: true,
}));

app.get('/', (req, res) => {
  res.send('<h2>🛠 Dashboard</h2><p>More tools coming soon!</p>');
});

app.listen(PORT, () => console.log(`🌐 Dashboard running on port ${PORT}`));
