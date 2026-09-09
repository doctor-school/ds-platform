SELECT extname,extversion FROM pg_extension ORDER BY extname;
SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner),c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='drill' ORDER BY c.relname;
SELECT defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl FROM pg_default_acl ORDER BY 1,2,3;
-- PG18 adds first-class NOT NULL pg_constraint rows. Compare that invariant via
-- attnotnull on both majors, and compare all other constraints by definition.
SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='drill'::regnamespace AND contype <> 'n' ORDER BY conname;
SELECT c.relname,a.attname,a.attnotnull,format_type(a.atttypid,a.atttypmod) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='drill'::regnamespace AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum;
SELECT id,retained,embedding::text FROM drill.records ORDER BY id;
SELECT last_value,is_called FROM drill.records_id_seq;
SELECT marker FROM drill.markers ORDER BY marker;
SELECT id FROM drill.records ORDER BY embedding <-> '[1,0,0]' LIMIT 1;
SELECT id,created_at FROM drill.events ORDER BY created_at,id;
SELECT parent_table,control,partition_interval,retention,retention_keep_table FROM partman.part_config ORDER BY parent_table;
SELECT loid,pageno,md5(data) FROM pg_largeobject ORDER BY loid,pageno;
