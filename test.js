const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = 3000

mongoose.connect(`mongodb+srv://vikas:wAtXb5w8uuk2Qq2A@jockey.kv9wgff.mongodb.net/jockey_otp_login_uat?retryWrites=true&w=majority&appName=jockey`).then(() => {
  console.log("DB connection Successful");
}).catch(error => {
  console.log(error.name, error.message);
});

app.get('/health', (req, res) => {
  res.send('ok');
});

app.post('/api/otp/send', (req, res) => {
  res.json({ success: true, message: "otp sent successfully" });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
