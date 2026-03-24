const express = require('express');

const app = express();
const PORT = 3000


app.get('/health', (req, res) => {
  res.send('ok');
});

app.post('/api/otp/send', (req, res) => {
  console.log(req.body)
  res.json({ success: true, message: "otp sent successfully" });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
