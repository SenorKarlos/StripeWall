<?php
include('oauth/config.php');

// GRAB IP ADDRESS OF USER
if (isset($_SERVER["HTTP_X_FORWARDED_FOR"])) {
    $ip = $_SERVER["HTTP_X_FORWARDED_FOR"];
} elseif (isset($_SERVER["REMOTE_ADDR"])) {
    $ip = $_SERVER["REMOTE_ADDR"];
}
// CREATE CONNECTION
$conn = new mysqli($oc["DB_HOST"], $oc["DB_USERNAME"], $oc["DB_PASSWORD"], $oc["DB_DATABASE"]);
// CHECK CONNECTION
if ($conn->connect_error) { die("Connection failed " . $conn->connect_error); }
// CHECK FOR AUTHORIZATION
$query = "DELETE FROM oauth_authorization WHERE ip = ?";
if ($stmt = $conn->prepare($query)) {
  $stmt->bind_param("s", $ip);
  $stmt->execute();
  if($stmt->affected_rows === 0){
    $stmt->close();
    header("Location: ".$login_url."?ip=".$ip);
  } else{ $stmt->close(); }
} $conn->close();

include("index.php");
?>
