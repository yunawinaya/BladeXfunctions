SELECT SLEEP(20 - MOD(UNIX_TIMESTAMP(NOW(3)), 20)) AS slept,
       DATE_FORMAT(SYSDATE(3), '%Y-%m-%d %H:%i:%s.%f') AS released_at