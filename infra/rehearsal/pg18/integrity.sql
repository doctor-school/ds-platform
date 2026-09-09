SELECT extname,extversion FROM pg_extension ORDER BY extname;
SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner),c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='drill' ORDER BY c.relname;
SELECT defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl FROM pg_default_acl ORDER BY 1,2,3;
SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='drill'::regnamespace ORDER BY conname;
SELECT id,retained,embedding::text FROM drill.records ORDER BY id;
SELECT last_value,is_called FROM drill.records_id_seq;
SELECT marker FROM drill.markers ORDER BY marker;
SELECT id FROM drill.records ORDER BY embedding <-> '[1,0,0]' LIMIT 1;
