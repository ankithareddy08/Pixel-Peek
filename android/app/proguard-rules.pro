# Socket.IO + Engine.IO use reflection on internal classes
-keep class io.socket.** { *; }
-keep class okhttp3.** { *; }
-dontwarn okhttp3.**
-dontwarn io.socket.**
