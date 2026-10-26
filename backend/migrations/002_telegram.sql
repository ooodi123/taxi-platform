-- Этап 2: Telegram-бот таксопарка и уведомления пассажиру
ALTER TABLE tenants ADD COLUMN webhook_secret text;

ALTER TABLE passengers ADD COLUMN username text;
ALTER TABLE passengers ADD COLUMN language_code text;

-- последний статус, о котором пассажиру написал бот (чтобы не слать дубли)
ALTER TABLE orders ADD COLUMN passenger_notified_status text;
