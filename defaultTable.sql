CREATE TABLE IF NOT EXISTS linked_events (
  id VARCHAR(20) NOT NULL,
  server VARCHAR(20) NOT NULL,
  parentid VARCHAR(20) NOT NULL,
  PRIMARY KEY (id)
);
