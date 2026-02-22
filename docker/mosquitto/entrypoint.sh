#!/bin/sh
# If MQTT_USER and MQTT_PASSWORD are set, create a password file and disable anonymous access.
CONF="/mosquitto/config/mosquitto.conf"
PASSWD="/mosquitto/config/passwd"

if [ -n "$MQTT_USER" ] && [ -n "$MQTT_PASSWORD" ]; then
  echo "Setting up MQTT authentication for user: $MQTT_USER"
  mosquitto_passwd -b -c "$PASSWD" "$MQTT_USER" "$MQTT_PASSWORD"
  # Rewrite config: disable anonymous, point to password file
  sed -i 's|allow_anonymous true|allow_anonymous false|' "$CONF"
  echo "password_file $PASSWD" >> "$CONF"
else
  echo "MQTT_USER/MQTT_PASSWORD not set — running with anonymous access (dev mode)"
fi

exec mosquitto -c "$CONF"
