const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from docs directory
app.use(express.static('docs'));

// Serial port configuration (change COM3 to your ESP32 port)
const SERIAL_PORT = 'COM3';
const BAUD_RATE = 115200;

// Initialize serial port connection
const port = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

// Handle serial port events
port.on('open', () => {
  console.log(`Serial port ${SERIAL_PORT} opened at ${BAUD_RATE} baud`);
});

port.on('error', (err) => {
  console.error('Serial port error:', err.message);
});

// Parse incoming serial data and broadcast to clients
parser.on('data', (line) => {
  const cleanLine = line.trim();
  
  try {
    // Parse CSV format: steps,heartRate,fall
    const values = cleanLine.split(',');
    if (values.length === 3) {
      const sensorData = {
        steps: parseInt(values[0]),
        heartRate: parseInt(values[1]),
        fall: parseInt(values[2]) === 1
      };
      
      console.log('Parsed sensor data:', sensorData);
      
      // Broadcast to all connected clients
      io.emit('sensor-update', sensorData);
    } else {
      console.error('Invalid CSV format:', cleanLine);
    }
  } catch (error) {
    console.error('Parse error for:', cleanLine, error.message);
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start server
server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
  console.log('Socket.IO ready for connections');
});