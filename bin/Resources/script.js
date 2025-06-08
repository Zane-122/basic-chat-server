// Connect to WebSocket server
let ws = null;
let connected = false;

const connectionList = document.getElementById('connection-list');
const statusDiv = document.querySelector('.status');
const messageList = document.getElementById('message-list');
const messageInput = document.getElementById('message-input');
const senderName = document.getElementById('sender-name');
const connectButton = document.getElementById('connect-button');

let connections = [];
let messages = [];
let myConnection = {address: '', name: ''};

// Load saved name from localStorage if it exists
if (localStorage.getItem('chatName')) {
    senderName.value = localStorage.getItem('chatName');
    myConnection.name = senderName.value;
}

function updateStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.style.backgroundColor = isError ? '#f8d7da' : '#d4edda';
    statusDiv.style.color = isError ? '#721c24' : '#155724';
}

updateStatus("Disconnected from server, you can change your name", true);

function updateConnectionState(isConnected) {
    connected = isConnected;
    senderName.disabled = isConnected;
    connectButton.textContent = isConnected ? 'Disconnect' : 'Connect';
    connectButton.onclick = isConnected ? disconnectFromServer : connectToServer;
}

function disconnectFromServer() {
    if (ws) {
        ws.close();
    }
    updateConnectionState(false);
    updateStatus("Disconnected from server, you can change your name", true);
    connections = [];
    updateConnectionList();
}

function connectToServer() {
    if (ws) {
        ws.close();
    }
    
    updateConnectionState(false);
    updateStatus("Connecting...");

    // Set name before connecting
    myConnection.name = senderName.value.trim();
    if (!myConnection.name) {
        updateStatus("Please enter a name", true);
        return;
    }
    localStorage.setItem('chatName', myConnection.name);

    ws = new WebSocket('ws://' + window.location.hostname + ':4001/ws');

    ws.onopen = function() {
        updateStatus('Connected to server');
        updateConnectionState(true);
    };

    ws.onclose = function() {
        updateConnectionState(false);
        updateStatus('Disconnected from server', true);
    };

    ws.onerror = function(error) {
        updateConnectionState(false);
        updateStatus('Connection error: ' + error.message, true);
    };

    ws.onmessage = function(event) {
        console.log('Received message:', event.data);
        let eventDataJson = '';
        try {
            eventDataJson = JSON.parse(event.data);
        } catch {
            console.error("NOT A JSON");
        }

        if (event.data.startsWith('New connection:')) {
            const fullAddress = event.data.split(':')[1].trim();
            console.log("NEW CONNECTION");
            if (!connections.some(conn => conn.address === fullAddress)) {
                connections.push({address: fullAddress, name: ""});
                updateConnectionList();
            }
        } else if (event.data.startsWith('Closed connection:')) {
            const fullAddress = event.data.split(':')[1].trim();
            console.log("CLOSED CONNECTION");
            connections = connections.filter(conn => conn.address !== fullAddress);
            updateConnectionList();
        } else if (eventDataJson.type === "name-update" || eventDataJson.type === "update-name") {
            const address = eventDataJson.address;
            const name = eventDataJson.name;

            console.log("NAME UPDATE", address, name);
            
            // Update connection name
            let connection = connections.find(conn => conn.address === address);
            if (connection) {
                connection.name = name;
            } else {
                connections.push({address: address, name: name});
            }

            // Update my name if it's my address
            if (address === myConnection.address) {
                myConnection.name = name;
            }
            
            updateConnectionList();
        } else if (eventDataJson.type === "message") {
            try {
                const messageData = JSON.parse(event.data);
                console.log('Parsed message data:', messageData);
                const sender = messageData.sender === (myConnection.address) || messageData.sender === (myConnection.name) ? 'You' : messageData.sender;
                const timestamp = new Date().toLocaleTimeString();
                messages.push({
                    content: `${sender}: ${messageData.content}`,
                    timestamp: timestamp
                });
                updateMessageList();
            } catch (e) {
                console.error('Error parsing message:', e);
            }
        } else if (event.data.startsWith("Your address:")) {
            myConnection.address = event.data.split(":")[1].trim();
            // Send initial name update immediately after getting address
            fetch('/update-name', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    address: myConnection.address,
                    name: myConnection.name
                })
            });
        }
    };
}

function updateConnectionList() {
    connectionList.innerHTML = connections.length ? 
        connections.map(conn => {
            if (conn.address === myConnection.address) {
                return `<li>You (${myConnection.name})</li>`;
            }
            return `<li>${conn.name || conn.address}</li>`;
        }).join('') :
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
    if (message && myConnection.address !== '') {
        console.log('Sending message:', message);
        ws.send(JSON.stringify({
            type: "message",
            content: message,
            sender: myConnection.name,
            timestamp: new Date().toLocaleTimeString()
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
        [...messages].reverse().map((msg, index) => {
            const isOwnMessage = msg.content.includes('You:');
            const gradientIntensity = Math.min(0.2 + (index * 0.05), 0.6);
            const backgroundColor = isOwnMessage 
                ? `rgba(135, 206, 235, ${gradientIntensity})` 
                : `rgba(240, 240, 240, ${gradientIntensity})`;
            
            return `<li class="${isOwnMessage ? 'own-message' : ''}" style="background-color: ${backgroundColor}">
                <span class="message-content">${msg.content}</span>
                <span class="message-timestamp">${msg.timestamp}</span>
            </li>`;
        }).join('') :
        '<li style="text-align: center; color: #6c757d;">No messages yet</li>';
    
    messageList.scrollTop = 0;
}

// Add enter key support for sending messages
messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Add enter key support for connecting
senderName.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        connectToServer();
    }
});

// Initialize button state
updateConnectionState(false);