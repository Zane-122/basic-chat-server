// Connect to WebSocket server
const ws = new WebSocket('ws://' + window.location.hostname + ':4001/ws');
const connectionList = document.getElementById('connection-list');
const statusDiv = document.querySelector('.status');
const messageList = document.getElementById('message-list');
const messageInput = document.getElementById('message-input');
const senderName = document.getElementById('sender-name');

let connections = [];
let messages = [];
let myAddress = null;
let myName = null;

// Load saved name from localStorage if it exists
if (localStorage.getItem('chatName')) {
    senderName.value = localStorage.getItem('chatName');
    myName = senderName.value;
}

// Save name when it changes
senderName.addEventListener('change', function() {
    myName = this.value.trim() || window.location.hostname;
    localStorage.setItem('chatName', this.value);
});

function updateStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.style.backgroundColor = isError ? '#f8d7da' : '#d4edda';
    statusDiv.style.color = isError ? '#721c24' : '#155724';
}

ws.onopen = function() {
    updateStatus('Connected to server');
    // Get our address from the WebSocket URL
    const wsUrl = new URL(ws.url);
    myAddress = window.location.hostname;
    if (myAddress === 'localhost' || myAddress === '127.0.0.1') {
        myAddress = 'localhost';
    }
    // Set default name if not already set
    if (!myName) {
        myName = senderName.value.trim() || myAddress;
        localStorage.setItem('chatName', senderName.value);
    }
    console.log('My address:', myAddress);
    console.log('My name:', myName);
    
    fetch('/addConnection', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            address: myAddress
        })
    });
};

ws.onclose = function() {
    updateStatus('Disconnected from server', true);
    fetch('/removeConnection', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            address: myAddress
        })
    });
};

ws.onerror = function(error) {
    updateStatus('Connection error: ' + error.message, true);
};

ws.onmessage = function(event) {
    console.log('Received message:', event.data);
    if (event.data.startsWith('New connection:')) {
        const fullAddress = event.data.split(':')[1].trim();
        const address = cleanAddress(fullAddress);

        if (!connections.includes(address)) {
            connections.push(address);
            updateConnectionList();
        }
    } else if (event.data.startsWith('Closed connection:')) {
        const fullAddress = event.data.split(':')[1].trim();
        const address = cleanAddress(fullAddress);
        
        connections = connections.filter(conn => conn !== address);
        updateConnectionList();
    } else {
        try {
            const messageData = JSON.parse(event.data);
            console.log('Parsed message data:', messageData);
            const sender = messageData.sender === (myAddress) || messageData.sender === (myName) ? 'You' : messageData.sender;
            messages.push(`${sender}: ${messageData.content}`);
            updateMessageList();
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    }
};

function updateConnectionList() {
    connectionList.innerHTML = connections.length ? 
        connections.map(conn => `<li>${conn}</li>`).join('') :
        '<li style="text-align: center; color: #6c757d;">No active connections</li>';
}

function cleanAddress(address) {
    // Remove the leading slash and brackets
    address = address.replace(/^\/\[|\]$/g, '');
    // Replace IPv6 localhost with "localhost"
    if (address.startsWith('0:0:0:0:0:0:0:1')) {
        return 'localhost';
    }
    return address;
}

function sendMessage() {
    const message = messageInput.value.trim();
    if (message) {
        console.log('Sending message:', message);
        ws.send(JSON.stringify({
            content: message,
            sender: myName || myAddress
        }));
        messageInput.value = '';
    }
}

function clearMessages() {
    messages = [];
    updateMessageList();
}

function updateMessageList() {
    messageList.innerHTML = messages.length ? 
        messages.map(msg => {
            const isOwnMessage = msg.startsWith(myName + ':') || msg.startsWith('You:');
            return `<li class="${isOwnMessage ? 'own-message' : ''}">${msg}</li>`;
        }).join('') :
        '<li style="text-align: center; color: #6c757d;">No messages yet</li>';
}