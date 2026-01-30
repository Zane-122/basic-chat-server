package backend;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Set;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

public class App {
    private static Set<WebSocket> connections = new HashSet<>();
    private static Map<String, String> users = new HashMap<>();
    private static Map<String, String> userRooms = new HashMap<>(); // address -> room hash

    private static WebSocketServer wsServer;

    public static void main(String[] args) throws Exception {
        try {
            // Create an HttpServer instance
            HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", 4000), 0);

            // Create a context for the server
            server.createContext("/", new PageHandler());
            server.createContext("/update-name", new UpdateNameHandler());

            // Create and start WebSocket server
            wsServer = new WebSocketServer(new InetSocketAddress("0.0.0.0", 4001)) {
                @Override
                public void onOpen(WebSocket conn, ClientHandshake handshake) {
                    // Check if the path is /ws
                    if (!handshake.getResourceDescriptor().equals("/ws")) {
                        conn.close(1008, "Invalid path");
                        return;
                    }
                    
                    String address = conn.getRemoteSocketAddress().toString();
                    // Convert IPv6 localhost to "localhost" but keep the port
                    if (address.contains("0:0:0:0:0:0:0:1")) {
                        String port = address.substring(address.lastIndexOf(":"));
                        address = "localhost" + port;
                    } else {
                        address = address.replace("/", "");
                    }
                    System.out.println("New connection: " + address);

                    // Add the new connection first
                    connections.add(conn);
                    
                    // Send the new client their address
                    conn.send("Your address: " + address);
                    
                    // Note: Don't send existing users here - they will be sent through the
                    // room-filtered update-name flow when the client sets their room/password
                }

                @Override
                public void onClose(WebSocket conn, int code, String reason, boolean remote) {
                    String address = conn.getRemoteSocketAddress().toString();
                    // Convert IPv6 localhost to "localhost" but keep the port
                    if (address.contains("0:0:0:0:0:0:0:1")) {
                        String port = address.substring(address.lastIndexOf(":"));
                        address = "localhost" + port;
                    } else {
                        address = address.replace("/", "");
                    }
                    String addressWithoutPort = address.split(":")[0].trim();
                    
                    // Remove from connections set first
                    if (connections.contains(conn)) {
                        connections.remove(conn);
                    }
                    
                    // Then remove from users map
                    if (users.containsKey(addressWithoutPort)) {
                        users.remove(addressWithoutPort);
                    }

                    System.out.println("Remaining connections: " + connections.size());
                    System.out.println("Remaining users: " + users);

                    // Notify other clients in the same room about the disconnection
                    String disconnectedRoom = userRooms.get(addressWithoutPort);
                    String disconnectedRoomNorm = (disconnectedRoom == null) ? "" : disconnectedRoom;
                    
                    for (WebSocket client : connections) {
                        if (client != conn && client.isOpen()) {
                            String clientAddress = client.getRemoteSocketAddress().toString();
                            if (clientAddress.contains("0:0:0:0:0:0:0:1")) {
                                String port = clientAddress.substring(clientAddress.lastIndexOf(":"));
                                clientAddress = "localhost" + port;
                            } else {
                                clientAddress = clientAddress.replace("/", "");
                            }
                            String clientAddressWithoutPort = clientAddress.split(":")[0].trim();
                            String clientRoom = userRooms.get(clientAddressWithoutPort);
                            String clientRoomNorm = (clientRoom == null) ? "" : clientRoom;
                            
                            // Only notify if in the same room
                            if (disconnectedRoomNorm.equals(clientRoomNorm)) {
                                client.send("Closed connection: " + address);
                            }
                        }
                    }
                    
                    // Clean up room info
                    userRooms.remove(addressWithoutPort);
                }

                @Override
                public void onMessage(WebSocket conn, String message) {
                    System.out.println("Message from " + conn.getRemoteSocketAddress() + ": " + message);
                    
                    // Get sender's room
                    String senderAddress = conn.getRemoteSocketAddress().toString();
                    if (senderAddress.contains("0:0:0:0:0:0:0:1")) {
                        String port = senderAddress.substring(senderAddress.lastIndexOf(":"));
                        senderAddress = "localhost" + port;
                    } else {
                        senderAddress = senderAddress.replace("/", "");
                    }
                    String senderAddressWithoutPort = senderAddress.split(":")[0].trim();
                    String senderRoom = userRooms.get(senderAddressWithoutPort);
                    
                    // Only send to clients in the same room
                    for (WebSocket client : connections) {
                        String clientAddress = client.getRemoteSocketAddress().toString();
                        if (clientAddress.contains("0:0:0:0:0:0:0:1")) {
                            String port = clientAddress.substring(clientAddress.lastIndexOf(":"));
                            clientAddress = "localhost" + port;
                        } else {
                            clientAddress = clientAddress.replace("/", "");
                        }
                        String clientAddressWithoutPort = clientAddress.split(":")[0].trim();
                        String clientRoom = userRooms.get(clientAddressWithoutPort);
                        
                        // Send if both in same room (empty matches empty, key matches same key)
                        String senderRoomNorm = (senderRoom == null) ? "" : senderRoom;
                        String clientRoomNorm = (clientRoom == null) ? "" : clientRoom;
                        boolean roomsMatch = senderRoomNorm.equals(clientRoomNorm);
                        if (roomsMatch) {
                            client.send(message);
                        }
                    }
                }

                @Override
                public void onError(WebSocket conn, Exception ex) {
                    if (conn != null) {
                        System.err.println("Error on connection " + conn.getRemoteSocketAddress() + ": " + ex.getMessage());
                    } else {
                        System.err.println("WebSocket error: " + ex.getMessage());
                    }
                }

                @Override
                public void onStart() {
                    System.out.println("WebSocket server started on port 4001");
                }
            };
            
            wsServer.start();

            // Start the HTTP server
            server.setExecutor(null);
            server.start();

            System.out.println("HTTP server started at http://localhost:4000/");
        } catch (Exception e) {
            System.err.println("Error starting server: " + e.getMessage());
            e.printStackTrace();
        }
    }

    static class PageHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String path = exchange.getRequestURI().getPath();
            String filePath;
            String contentType;

            if (path.equals("/script.js")) {
                filePath = "src/Resources/script.js";
                contentType = "application/javascript";
            } else {
                filePath = "src/Resources/Index.html";
                contentType = "text/html";
            }
            
            // Set content type
            exchange.getResponseHeaders().set("Content-Type", contentType);
            
            // Read file content
            byte[] responseBytes = Files.readAllBytes(Paths.get(filePath));
            
            exchange.sendResponseHeaders(200, responseBytes.length);
            OutputStream os = exchange.getResponseBody();
            os.write(responseBytes);
            os.close();
        }
    }

    static class UpdateNameHandler implements HttpHandler{ 
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String requestBody = new String(exchange.getRequestBody().readAllBytes());
            System.out.println(requestBody);

            JSONObject json = new JSONObject(requestBody);
            String address = json.get("address").toString();
            String name = json.get("name").toString();
            String roomHash = json.optString("roomHash", "");
            
            System.out.println("address: " + address + ", roomHash: " + roomHash);
            
            users.put(address, name);
            // Always update userRooms - empty string for public, hash for private
            userRooms.put(address, roomHash);
            System.out.println("THESE ARE THE USERS: " + users);
            System.out.println("THESE ARE THE ROOMS: " + userRooms);

            // Build response with room info
            JSONObject responseJson = new JSONObject();
            responseJson.put("type", "update-name");
            responseJson.put("address", address);
            responseJson.put("name", name);
            responseJson.put("roomHash", roomHash);

            // Find the WebSocket for the user who just updated their name
            WebSocket joinerSocket = null;
            for (WebSocket client : connections) {
                if (client.isOpen()) {
                    String clientAddress = client.getRemoteSocketAddress().toString();
                    if (clientAddress.contains("0:0:0:0:0:0:0:1")) {
                        String port = clientAddress.substring(clientAddress.lastIndexOf(":"));
                        clientAddress = "localhost" + port;
                    } else {
                        clientAddress = clientAddress.replace("/", "");
                    }
                    String clientAddressWithoutPort = clientAddress.split(":")[0].trim();
                    if (clientAddressWithoutPort.equals(address)) {
                        joinerSocket = client;
                        break;
                    }
                }
            }

            // Send to all clients in the same room AND send existing same-room users to the joiner
            for (WebSocket client : connections) {
                if (client.isOpen()) {
                    String clientAddress = client.getRemoteSocketAddress().toString();
                    if (clientAddress.contains("0:0:0:0:0:0:0:1")) {
                        String port = clientAddress.substring(clientAddress.lastIndexOf(":"));
                        clientAddress = "localhost" + port;
                    } else {
                        clientAddress = clientAddress.replace("/", "");
                    }
                    String clientAddressWithoutPort = clientAddress.split(":")[0].trim();
                    String clientRoom = userRooms.get(clientAddressWithoutPort);
                    
                    // Check if rooms match (empty matches empty, key matches same key)
                    String clientRoomNorm = (clientRoom == null) ? "" : clientRoom;
                    boolean roomsMatch = roomHash.equals(clientRoomNorm);
                    
                    if (roomsMatch) {
                        // Send the new user's info to this client
                        client.send(responseJson.toString());
                        
                        // If this client is not the joiner, send their info to the joiner
                        if (joinerSocket != null && client != joinerSocket && users.containsKey(clientAddressWithoutPort)) {
                            JSONObject existingUser = new JSONObject();
                            existingUser.put("type", "update-name");
                            existingUser.put("address", clientAddressWithoutPort);
                            existingUser.put("name", users.get(clientAddressWithoutPort));
                            existingUser.put("roomHash", clientRoom != null ? clientRoom : "");
                            joinerSocket.send(existingUser.toString());
                        }
                    }
                }
            }

            // Send a response back to the client
            String response = "Name updated successfully";
            exchange.sendResponseHeaders(200, response.length());
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(response.getBytes());
            }
        }
    }
}
